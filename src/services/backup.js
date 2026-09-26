'use strict';

// Copia de seguridad completa (.json) y migración desde el CRM anterior (localStorage).
//
// El importador es tolerante con el formato: acepta el backup del CRM anterior tal cual
// (colecciones en la raíz, dentro de "data", o como strings JSON al estilo localStorage) y
// también el backup que genera esta versión. Cualquier campo sin columna propia se guarda en
// la columna "extra" para no perder información. stageHistory, bitácoras y auditoría se
// conservan íntegros.
//
// Contraseñas: el CRM anterior guardaba btoa(contraseña). Al importar se decodifica y se vuelve
// a guardar con bcrypt, de modo que cada usuario conserva su contraseña pero ahora con hash seguro.

const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const { hashPassword } = require('../auth');
const { audit } = require('../audit');
const { PROGRAMS, LOST } = require('../constants');
const {
  newId, mapUser, mapCompany, mapContact, mapDeal, mapTask, mapMessage, mapAudit, mapExpense,
} = require('../util');

// ------------------------------------------------------------------ exportación
async function exportBackup() {
  const q = (sql) => db.query(sql).then((r) => r.rows);
  const [users, companies, contacts, deals, tasks, messages, auditLog, expenses] = await Promise.all([
    q('SELECT * FROM users ORDER BY created_at'), q('SELECT * FROM companies ORDER BY created_at'),
    q('SELECT * FROM contacts ORDER BY created_at'), q('SELECT * FROM deals ORDER BY created_at'),
    q('SELECT * FROM tasks ORDER BY created_at'), q('SELECT * FROM messages ORDER BY at'),
    q('SELECT * FROM audit_log ORDER BY at'), q('SELECT * FROM expenses ORDER BY year, month, created_at'),
  ]);
  const withExtra = (mapper) => (r) => ({ ...(r.extra || {}), ...mapper(r) });
  return {
    app: 'futurocol-crm',
    version: 2,
    exportedAt: new Date().toISOString(),
    users: users.map((r) => ({ ...(r.extra || {}), ...mapUser(r, { full: true }), passwordHash: r.password_hash })),
    companies: companies.map(withExtra(mapCompany)),
    contacts: contacts.map(withExtra(mapContact)),
    deals: deals.map(withExtra(mapDeal)),
    tasks: tasks.map(withExtra(mapTask)),
    messages: messages.map(withExtra(mapMessage)),
    auditLog: auditLog.map(withExtra(mapAudit)),
    expenses: expenses.map(withExtra(mapExpense)),
    stages: await settings.getStages(),
    commissions: await settings.getCommissions(),
  };
}

// ------------------------------------------------------------------ lectura del backup
const COLLECTIONS = {
  users: ['users', 'usuarios'],
  companies: ['companies', 'empresas'],
  contacts: ['contacts', 'contactos', 'leads'],
  deals: ['deals', 'negocios'],
  tasks: ['tasks', 'tareas'],
  messages: ['messages', 'mensajes', 'chat'],
  auditLog: ['auditlog', 'audit', 'auditoria', 'logs', 'log'],
  expenses: ['expenses', 'gastos'],
  stages: ['stages', 'etapas', 'pipelinestages', 'pipeline'],
  commissions: ['commissions', 'comisiones', 'commissionsettings', 'commissionconfig', 'commission'],
  settings: ['settings', 'config', 'configuracion', 'ajustes'],
};
const CONTAINERS = ['data', 'db', 'state', 'backup', 'store', 'crm'];

const normKey = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '').replace(/^(futurocol|academy|crm|fcrm)+/, '');
const coerceJSON = (v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try { return JSON.parse(t); } catch { return v; }
};

function extractCollections(raw) {
  const out = {};
  const visit = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 4) return;
    for (const [k, v0] of Object.entries(obj)) {
      const v = coerceJSON(v0);
      const nk = normKey(k);
      const target = Object.keys(COLLECTIONS).find((t) => COLLECTIONS[t].includes(nk));
      if (target === 'settings' || (!target && CONTAINERS.includes(nk))) visit(v, depth + 1);
      else if (target && out[target] === undefined && v !== null && typeof v === 'object') out[target] = v;
    }
  };
  visit(coerceJSON(raw), 0);
  for (const k of ['users', 'companies', 'contacts', 'deals', 'tasks', 'messages', 'auditLog', 'expenses']) {
    const v = out[k];
    if (v && !Array.isArray(v) && typeof v === 'object') out[k] = Object.entries(v).map(([id, r]) => ({ id, ...r }));
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

// Toma el primer alias presente y lo marca como "usado" (lo demás va a extra).
function reader(rec) {
  const used = new Set();
  const get = (...keys) => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(rec, k)) {
        used.add(k);
        if (rec[k] !== undefined && rec[k] !== '') return rec[k];
      }
    }
    return undefined;
  };
  const extra = () => Object.fromEntries(Object.entries(rec).filter(([k]) => !used.has(k)));
  return { get, extra };
}

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const toTs = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = typeof v === 'number' || /^\d{10,13}$/.test(String(v)) ? new Date(Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const toDate = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
  const t = toTs(v);
  return t ? t.slice(0, 10) : null;
};
const toTime = (v) => (v && /^\d{1,2}:\d{2}/.test(String(v)) ? String(v).padStart(5, '0').slice(0, 5) : null);
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.') : v);
  return Number.isFinite(n) ? n : null;
};
const hashId = (prefix, obj) => `${prefix}_${crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 20)}`;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Convierte la contraseña del backup en un hash bcrypt.
async function resolvePassword(rec) {
  const h = rec.passwordHash ?? rec.password_hash ?? rec.pass ?? rec.hash;
  if (typeof h === 'string' && /^\$2[aby]\$\d{2}\$/.test(h)) return { hash: h, source: 'bcrypt' };
  if (typeof h === 'string' && h && /^[A-Za-z0-9+/]+={0,2}$/.test(h) && h.length % 4 === 0) {
    try {
      const bin = Buffer.from(h, 'base64').toString('latin1');
      // btoa() trabaja sobre latin1; si venía de unescape(encodeURIComponent()) se recupera el UTF-8.
      let plain = bin;
      try { plain = decodeURIComponent(escape(bin)); } catch { /* latin1 puro */ }
      if (plain && /^[\x20-\x7E -￿]+$/.test(plain)) return { hash: await hashPassword(plain), source: 'btoa' };
    } catch { /* no era base64 */ }
  }
  if (typeof rec.password === 'string' && rec.password) return { hash: await hashPassword(rec.password), source: 'plain' };
  // Sin contraseña recuperable: se asigna una aleatoria y el admin debe restablecerla.
  return { hash: await hashPassword(crypto.randomBytes(18).toString('base64')), source: 'random' };
}

function normalizeStagesInput(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    return v.map((s) => (typeof s === 'string' ? { id: s, label: s } : {
      id: str(s.id ?? s.key ?? s.value), label: str(s.label ?? s.name ?? s.title ?? s.id), probability: s.probability ?? s.prob,
    })).filter((s) => s.id);
  }
  if (typeof v === 'object') return Object.entries(v).map(([id, label]) => ({ id, label: typeof label === 'string' ? label : label?.label || id }));
  return null;
}

function normalizeCommissions(c) {
  if (!c || typeof c !== 'object') return null;
  const scales = c.asesorScales ?? c.scales ?? c.asesores ?? c.advisorScales ?? c.asesorRates;
  const list = Array.isArray(scales) ? scales.map(Number).filter(Number.isFinite) : undefined;
  const adminDefault = toNum(c.adminDefault ?? c.admin ?? c.adminRate);
  const asesorDefault = toNum(c.asesorDefault ?? c.asesor ?? c.defaultAsesor) ?? list?.[0];
  const out = {};
  if (adminDefault !== null && adminDefault !== undefined) out.adminDefault = adminDefault;
  if (asesorDefault !== null && asesorDefault !== undefined) out.asesorDefault = asesorDefault;
  if (list) out.asesorScales = list;
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ importación
/**
 * @param raw    contenido del .json
 * @param mode   'merge' (fusionar: agrega lo que no existe, conserva lo actual) |
 *               'replace' (restaurar: reemplaza empresas/contactos/negocios/tareas/mensajes;
 *               los usuarios se actualizan y la auditoría nunca se borra)
 * @param actor  usuario que ejecuta la importación (recibe los registros sin dueño válido)
 */
async function importBackup(raw, { mode = 'merge', actor }) {
  const data = extractCollections(raw);
  const warnings = [];
  const stats = {};
  const count = (k, field) => { stats[k] ||= { inserted: 0, skipped: 0, updated: 0 }; stats[k][field]++; };

  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(727003)');
    if (mode === 'replace') {
      await client.query('DELETE FROM tasks');
      await client.query('DELETE FROM deals');
      await client.query('DELETE FROM contacts');
      await client.query('DELETE FROM companies');
      await client.query('DELETE FROM messages');
      await client.query('DELETE FROM automation_log');
      if (data.expenses.length) await client.query('DELETE FROM expenses');
    }

    // ---------------- usuarios
    const userMap = new Map();
    const existingUsers = (await client.query('SELECT id, email, username FROM users')).rows;
    const takenUsernames = new Set(existingUsers.map((u) => u.username.toLowerCase()));
    const takenEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    for (const rec of data.users) {
      const r = reader(rec);
      const oldId = str(r.get('id', '_id', 'uid'));
      const name = str(r.get('name', 'nombre', 'fullName')) || str(rec.username) || 'Usuario';
      let email = str(r.get('email', 'correo', 'mail'))?.toLowerCase() || null;
      let username = str(r.get('username', 'user', 'usuario', 'login')) || (email ? email.split('@')[0] : settings.slug(name));
      const role = r.get('role', 'rol') === 'admin' ? 'admin' : 'asesor';
      const rate = toNum(r.get('commissionRate', 'commission_rate', 'comision', 'commission'));
      const createdAt = toTs(r.get('createdAt', 'created_at')) || new Date().toISOString();
      r.get('passwordHash', 'password_hash', 'password', 'pass', 'hash');

      const match = existingUsers.find((u) => u.id === oldId)
        || (email && existingUsers.find((u) => u.email.toLowerCase() === email))
        || existingUsers.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
      if (match) {
        if (oldId) userMap.set(oldId, match.id);
        if (mode === 'replace' && match.id !== actor.id) {
          const pw = await resolvePassword(rec);
          const emailOk = email && EMAIL_RE.test(email) && !existingUsers.some((u) => u.id !== match.id && u.email.toLowerCase() === email);
          await client.query(
            `UPDATE users SET name = $1, role = $2, commission_rate = $3, password_hash = $4,
               email = COALESCE($5, email), token_version = token_version + 1 WHERE id = $6`,
            [name, role, rate, pw.hash, emailOk ? email : null, match.id],
          );
          count('users', 'updated');
        } else count('users', 'skipped');
        continue;
      }
      const extra = r.extra();
      if (!email || !EMAIL_RE.test(email) || takenEmails.has(email)) {
        extra.originalEmail = email;
        email = `${settings.slug(username)}.${crypto.randomBytes(3).toString('hex')}@sin-correo.invalid`;
        warnings.push(`Usuario "${name}" sin correo válido/único: se asignó ${email}. Actualízalo en Usuarios.`);
      }
      while (takenUsernames.has(username.toLowerCase())) username = `${username}_${crypto.randomBytes(2).toString('hex')}`;
      const pw = await resolvePassword(rec);
      if (pw.source === 'random') warnings.push(`Usuario "${name}": contraseña no recuperable; restablécela en Usuarios.`);
      const id = oldId && !existingUsers.some((u) => u.id === oldId) ? oldId : newId('u');
      await client.query(
        `INSERT INTO users (id, name, username, email, password_hash, role, commission_rate, extra, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, name, username, email, pw.hash, role, rate, JSON.stringify(extra), createdAt],
      );
      existingUsers.push({ id, email, username });
      takenUsernames.add(username.toLowerCase());
      takenEmails.add(email);
      if (oldId) userMap.set(oldId, id);
      count('users', 'inserted');
    }
    const allUserIds = new Set(existingUsers.map((u) => u.id));
    const nameToUser = new Map((await client.query('SELECT id, name FROM users')).rows.map((u) => [u.name.toLowerCase(), u.id]));
    let orphaned = 0;
    const owner = (v) => {
      const k = str(v);
      if (k && userMap.has(k)) return userMap.get(k);
      if (k && allUserIds.has(k)) return k;
      if (k && nameToUser.has(k.toLowerCase())) return nameToUser.get(k.toLowerCase());
      orphaned++;
      return actor.id; // nunca huérfanos
    };

    // ---------------- configuración
    const current = await settings.getStages(client);
    const backupStages = normalizeStagesInput(data.stages);
    let stages = mode === 'replace' && backupStages?.length ? settings.normalizeStages(backupStages) : current;
    if (mode !== 'replace' && backupStages) {
      const missing = backupStages.filter((s) => !stages.some((x) => x.id === s.id));
      if (missing.length) stages = settings.normalizeStages([...stages, ...missing]);
    }
    const stageAliases = new Map(stages.map((s) => [s.label.toLowerCase(), s.id]));
    const commissions = normalizeCommissions(data.commissions);
    if (commissions && (mode === 'replace' || !(await client.query("SELECT 1 FROM settings WHERE key = 'commissions'")).rows[0])) {
      await settings.set('commissions', { ...(await settings.getCommissions(client)), ...commissions }, client);
    }

    // ---------------- empresas
    for (const rec of data.companies) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('co', rec);
      const vals = [
        id, str(r.get('name', 'nombre', 'razonSocial')) || 'Sin nombre', str(r.get('nit')), str(r.get('domain', 'dominio', 'website')),
        str(r.get('phone', 'telefono')), str(r.get('email', 'correo')), str(r.get('address', 'direccion')),
        str(r.get('city', 'ciudad')), str(r.get('department', 'departamento')), str(r.get('country', 'pais')),
        str(r.get('sector', 'industry')), str(r.get('employees', 'empleados')), str(r.get('source', 'fuente', 'origen')),
        str(r.get('notes', 'notas')), owner(r.get('assignedTo', 'assigned_to', 'owner', 'ownerId')),
        toTs(r.get('createdAt', 'created_at')) || new Date().toISOString(),
      ];
      const res = await client.query(
        `INSERT INTO companies (id, name, nit, domain, phone, email, address, city, department, country, sector,
           employees, source, notes, assigned_to, created_at, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
        [...vals, JSON.stringify(r.extra())],
      );
      count('companies', res.rowCount ? 'inserted' : 'skipped');
    }
    const companyIds = new Set((await client.query('SELECT id FROM companies')).rows.map((x) => x.id));

    // ---------------- contactos
    const normProgram = (p) => {
      if (!p) return null;
      const n = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      return PROGRAMS.find((x) => n(x) === n(String(p))) || String(p);
    };
    for (const rec of data.contacts) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('c', rec);
      let companyId = str(r.get('companyId', 'company_id', 'empresaId', 'company'));
      const extra = r.extra();
      if (companyId && !companyIds.has(companyId)) { extra.originalCompanyId = companyId; companyId = null; }
      const activity = coerceJSON(r.get('activity', 'activities', 'bitacora', 'log'));
      const res = await client.query(
        `INSERT INTO contacts (id, name, phone, email, company_id, program, city, notes, assigned_to, created_at, activity, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [id, str(r.get('name', 'nombre')) || 'Sin nombre', str(r.get('phone', 'telefono', 'celular')),
          str(r.get('email', 'correo')), companyId, normProgram(r.get('program', 'programa')), str(r.get('city', 'ciudad')),
          str(r.get('notes', 'notas')), owner(r.get('assignedTo', 'assigned_to', 'owner', 'ownerId', 'asesor')),
          toTs(r.get('createdAt', 'created_at')) || new Date().toISOString(),
          JSON.stringify(Array.isArray(activity) ? activity : []), JSON.stringify(extra)],
      );
      count('contacts', res.rowCount ? 'inserted' : 'skipped');
    }
    const contactIds = new Set((await client.query('SELECT id FROM contacts')).rows.map((x) => x.id));

    // ---------------- negocios
    const addedStages = [];
    for (const rec of data.deals) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('d', rec);
      const extra = r.extra();
      let stage = str(r.get('stage', 'etapa', 'status')) || stages[0].id;
      if (!stages.some((s) => s.id === stage)) {
        if (stageAliases.has(stage.toLowerCase())) stage = stageAliases.get(stage.toLowerCase());
        else {
          stages = settings.normalizeStages([...stages, { id: stage, label: stage }]);
          stageAliases.set(stage.toLowerCase(), stage);
          addedStages.push(stage);
        }
      }
      let contactId = str(r.get('contactId', 'contact_id', 'contacto', 'contact'));
      if (contactId && !contactIds.has(contactId)) { extra.originalContactId = contactId; contactId = null; }
      let lossReason = str(r.get('lossReason', 'loss_reason', 'motivoPerdida'));
      if (stage === LOST && !lossReason) {
        lossReason = 'Sin motivo registrado (importado)';
        extra.lossReasonMissing = true;
      }
      const prob = toNum(r.get('probability', 'probabilidad'));
      const history = coerceJSON(r.get('stageHistory', 'stage_history', 'history', 'historial'));
      const res = await client.query(
        `INSERT INTO deals (id, title, contact_id, value, stage, deal_type, product, convocatoria, probability,
           expected_close_date, close_date, competitor, next_step, loss_reason, assigned_to, created_at, stage_history, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO NOTHING`,
        [id, str(r.get('title', 'titulo', 'name', 'nombre')) || 'Sin título', contactId,
          toNum(r.get('value', 'valor', 'amount')) ?? 0, stage, str(r.get('dealType', 'deal_type', 'tipo', 'type')),
          str(r.get('product', 'producto', 'programa')), str(r.get('convocatoria')),
          prob === null ? null : Math.max(0, Math.min(100, Math.round(prob))),
          toDate(r.get('expectedCloseDate', 'expected_close_date', 'fechaEsperada')),
          toDate(r.get('closeDate', 'close_date', 'fechaCierre')), str(r.get('competitor', 'competidor')),
          str(r.get('nextStep', 'next_step', 'siguientePaso')), lossReason,
          owner(r.get('assignedTo', 'assigned_to', 'owner', 'ownerId', 'asesor')),
          toTs(r.get('createdAt', 'created_at')) || new Date().toISOString(),
          JSON.stringify(Array.isArray(history) ? history : []), JSON.stringify(extra)],
      );
      count('deals', res.rowCount ? 'inserted' : 'skipped');
    }
    if (addedStages.length) warnings.push(`Se agregaron etapas que existían en los negocios importados: ${addedStages.join(', ')}`);
    await settings.set('stages', stages, client);

    // ---------------- tareas
    const dealIds = new Set((await client.query('SELECT id FROM deals')).rows.map((x) => x.id));
    for (const rec of data.tasks) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('t', rec);
      const extra = r.extra();
      let contactId = str(r.get('contactId', 'contact_id', 'contacto'));
      if (contactId && !contactIds.has(contactId)) { extra.originalContactId = contactId; contactId = null; }
      let dealId = str(r.get('dealId', 'deal_id'));
      if (dealId && !dealIds.has(dealId)) { extra.originalDealId = dealId; dealId = null; }
      const autoRule = str(r.get('autoRule', 'auto_rule', 'auto'));
      const done = [true, 'true', 1, '1'].includes(r.get('done', 'completed', 'completada'));
      const dup = autoRule && (await client.query('SELECT 1 FROM tasks WHERE auto_rule = $1 AND id <> $2', [autoRule, id])).rows[0];
      const res = await client.query(
        `INSERT INTO tasks (id, contact_id, deal_id, title, type, due_date, contact_time, schedule_time, notes, done,
           completed_at, assigned_to, created_at, auto_rule, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
        [id, contactId, dealId, str(r.get('title', 'titulo')) || 'Tarea', str(r.get('type', 'tipo')) || 'otro',
          toDate(r.get('dueDate', 'due_date', 'fecha')), toTime(r.get('contactTime', 'contact_time', 'hora')),
          toTime(r.get('scheduleTime', 'schedule_time')), str(r.get('notes', 'notas')), done,
          toTs(r.get('completedAt', 'completed_at')), owner(r.get('assignedTo', 'assigned_to', 'owner', 'asesor')),
          toTs(r.get('createdAt', 'created_at')) || new Date().toISOString(), dup ? null : autoRule,
          JSON.stringify(dup ? { ...extra, autoRule } : extra)],
      );
      if (res.rowCount && autoRule) {
        await client.query('INSERT INTO automation_log (rule, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [autoRule, id]);
      }
      count('tasks', res.rowCount ? 'inserted' : 'skipped');
    }

    // ---------------- mensajes (sin FK: se conservan aunque el usuario ya no exista)
    const msgUser = (v) => {
      const k = str(v);
      return (k && userMap.get(k)) || k || actor.id;
    };
    for (const rec of data.messages) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('m', rec);
      const res = await client.query(
        `INSERT INTO messages (id, from_user, to_user, text, at, extra) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [id, msgUser(r.get('from', 'fromUser', 'from_user', 'de')), msgUser(r.get('to', 'toUser', 'to_user', 'para')),
          str(r.get('text', 'texto', 'body', 'message')) || '', toTs(r.get('at', 'date', 'createdAt', 'fecha')) || new Date().toISOString(),
          JSON.stringify(r.extra())],
      );
      count('messages', res.rowCount ? 'inserted' : 'skipped');
    }

    // ---------------- auditoría (solo se agrega; nunca se modifica ni borra)
    for (const rec of data.auditLog) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('log', rec);
      const byId = str(r.get('byUserId', 'by_user_id', 'userId'));
      const res = await client.query(
        `INSERT INTO audit_log (id, at, by_name, by_user_id, action, entity_type, entity_label, detail, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [id, toTs(r.get('at', 'date', 'fecha', 'timestamp')) || new Date().toISOString(),
          str(r.get('by', 'user', 'usuario', 'byName')) || 'Desconocido', byId ? userMap.get(byId) || byId : null,
          str(r.get('action', 'accion')) || 'edición', str(r.get('entityType', 'entity_type', 'entity', 'tipo')),
          str(r.get('entityLabel', 'entity_label', 'label')), str(r.get('detail', 'detalle', 'details')), JSON.stringify(r.extra())],
      );
      count('auditLog', res.rowCount ? 'inserted' : 'skipped');
    }

    // ---------------- gastos de operación
    for (const rec of data.expenses) {
      const r = reader(rec);
      const id = str(r.get('id', '_id')) || hashId('g', rec);
      const year = toNum(r.get('year', 'anio'));
      const month = toNum(r.get('month', 'mes'));
      if (!year || !month || month < 1 || month > 12) { count('expenses', 'skipped'); continue; }
      const byId = str(r.get('createdBy', 'created_by'));
      const res = await client.query(
        `INSERT INTO expenses (id, year, month, category, description, amount, created_by, created_at, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [id, year, month, str(r.get('category', 'categoria')) || 'Otros', str(r.get('description', 'descripcion')),
          Math.max(0, toNum(r.get('amount', 'valor', 'monto')) ?? 0), byId ? userMap.get(byId) || byId : null,
          toTs(r.get('createdAt', 'created_at')) || new Date().toISOString(), JSON.stringify(r.extra())],
      );
      count('expenses', res.rowCount ? 'inserted' : 'skipped');
    }

    if (orphaned) warnings.push(`${orphaned} registro(s) tenían un responsable inexistente y se asignaron a ${actor.name}.`);
    const summary = Object.entries(stats).map(([k, v]) => `${k}: +${v.inserted}${v.updated ? ` ~${v.updated}` : ''}${v.skipped ? ` (=${v.skipped} ya existían)` : ''}`).join(' · ');
    await audit({
      client, by: actor, action: mode === 'replace' ? 'restauración' : 'importación', entityType: 'backup',
      entityLabel: mode === 'replace' ? 'Restaurar copia de seguridad' : 'Fusionar copia de seguridad', detail: summary || 'Sin registros',
    });
  });

  return { mode, stats, warnings };
}

module.exports = { exportBackup, importBackup, extractCollections, resolvePassword };
