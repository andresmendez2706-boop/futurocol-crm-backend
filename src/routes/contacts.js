'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { assertCanManage, isAdmin } = require('../permissions');
const { audit } = require('../audit');
const realtime = require('../realtime');
const repo = require('../services/repo');
const { resolveAssignee, userName } = require('../services/ownership');
const { PROGRAMS, ACTIVITY_TYPES } = require('../constants');
const { toCSV, parseCSV } = require('../csv');
const {
  ah, HttpError, newId, mapContact, buildSet, digits,
} = require('../util');
const {
  z, parse, reqText, optText,
} = require('../validate');

const router = express.Router();

const program = z.preprocess((v) => (v === '' ? null : v), z.enum(PROGRAMS).nullable().optional());
const base = {
  phone: optText(50), email: optText(200), companyId: optText(100), program, city: optText(100),
  notes: optText(10000), assignedTo: optText(100),
};
const createSchema = z.object({ name: reqText(200), ...base });
const updateSchema = z.object({ name: reqText(200).optional(), ...base });

// Duplicados: mismo email (exacto, sin mayúsculas) o mismo teléfono (comparando solo dígitos;
// con 10+ dígitos se ignora el indicativo de país).
async function findDuplicates({ email, phone, excludeId }, viewer) {
  const phoneDigits = digits(phone);
  if (!email && phoneDigits.length < 6) return [];
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.email, c.phone, c.assigned_to, u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.assigned_to
      WHERE c.id IS DISTINCT FROM $3
        AND (($1::text IS NOT NULL AND lower(c.email) = lower($1))
          OR ($2::text <> '' AND (
                regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') = $2
                -- mismo número con o sin indicativo (+57): se comparan los últimos 10 dígitos
             OR (length($2) >= 10 AND length(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g')) >= 10
                 AND right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = right($2, 10)))))`,
    [email || null, phoneDigits.length >= 6 ? phoneDigits : '', excludeId || null],
  );
  // Los contactos ajenos se informan de forma mínima (existe y quién lo tiene).
  return rows.map((r) => {
    const visible = isAdmin(viewer) || r.assigned_to === viewer.id;
    return {
      id: visible ? r.id : null,
      name: visible ? r.name : 'Contacto de otro asesor',
      email: visible ? r.email : null,
      phone: visible ? r.phone : null,
      owner: r.owner_name,
      match: email && r.email && r.email.toLowerCase() === email.toLowerCase() ? 'email' : 'teléfono',
    };
  });
}

async function assertCompany(companyId) {
  if (!companyId) return;
  const { rows } = await db.query('SELECT id FROM companies WHERE id = $1', [companyId]);
  if (!rows[0]) throw new HttpError(400, 'La empresa indicada no existe');
}

router.get('/', ah(async (req, res) => res.json(await repo.listContacts(req.user))));

router.post('/check-duplicates', ah(async (req, res) => {
  const q = parse(z.object({ email: optText(200), phone: optText(50), excludeId: optText(100) }), req.body);
  res.json({ duplicates: await findDuplicates(q, req.user) });
}));

router.post('/', ah(async (req, res) => {
  const data = parse(createSchema, req.body);
  await assertCompany(data.companyId);
  const assignedTo = await resolveAssignee(req.user, data.assignedTo);
  const duplicates = await findDuplicates(data, req.user);
  const { rows } = await db.query(
    `INSERT INTO contacts (id, name, phone, email, company_id, program, city, notes, assigned_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [newId('c'), data.name, data.phone ?? null, data.email ?? null, data.companyId ?? null, data.program ?? null,
      data.city ?? null, data.notes ?? null, assignedTo],
  );
  await audit({
    by: req.user, action: 'creación', entityType: 'contacto', entityLabel: data.name,
    detail: duplicates.length ? `Creado pese a ${duplicates.length} posible(s) duplicado(s)` : null,
  });
  realtime.notifyChange('contacts');
  res.status(201).json({ ...mapContact(rows[0]), duplicates });
}));

router.patch('/:id', ah(async (req, res) => {
  const data = parse(updateSchema, req.body);
  const current = await repo.getRow('contacts', req.params.id);
  if (!current) throw new HttpError(404, 'Contacto no encontrado');
  assertCanManage(req.user, current, 'este contacto');
  if (data.companyId) await assertCompany(data.companyId);
  const cols = {
    name: data.name, phone: data.phone, email: data.email, company_id: data.companyId, program: data.program,
    city: data.city, notes: data.notes,
  };
  if (data.assignedTo && data.assignedTo !== current.assigned_to) {
    cols.assigned_to = await resolveAssignee(req.user, data.assignedTo);
  }
  const set = buildSet(cols);
  if (!set.count) return res.json(mapContact(current));
  const { rows } = await db.query(
    `UPDATE contacts SET ${set.sql}, updated_at = now() WHERE id = $${set.count + 1} RETURNING *`,
    [...set.values, current.id],
  );
  if (cols.assigned_to) {
    await audit({ by: req.user, action: 'cambio de responsable', entityType: 'contacto', entityLabel: rows[0].name, detail: `→ ${await userName(cols.assigned_to)}` });
  }
  await audit({ by: req.user, action: 'edición', entityType: 'contacto', entityLabel: rows[0].name });
  realtime.notifyChange('contacts');
  res.json(mapContact(rows[0]));
}));

// Bitácora de actividades
router.post('/:id/activity', ah(async (req, res) => {
  const data = parse(z.object({ type: z.enum(ACTIVITY_TYPES), text: reqText(5000) }), req.body);
  const current = await repo.getRow('contacts', req.params.id);
  if (!current) throw new HttpError(404, 'Contacto no encontrado');
  assertCanManage(req.user, current, 'este contacto');
  const entry = { id: newId('a'), type: data.type, text: data.text, author: req.user.name, at: new Date().toISOString() };
  const { rows } = await db.query(
    "UPDATE contacts SET activity = activity || $1::jsonb, updated_at = now() WHERE id = $2 RETURNING *",
    [JSON.stringify([entry]), current.id],
  );
  realtime.notifyChange('contacts');
  res.status(201).json(mapContact(rows[0]));
}));

router.delete('/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await db.query('DELETE FROM contacts WHERE id = $1 RETURNING name', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Contacto no encontrado');
  await audit({ by: req.user, action: 'eliminación', entityType: 'contacto', entityLabel: rows[0].name });
  realtime.notifyChange('all');
  res.json({ ok: true });
}));

// ---- CSV (solo admin) ----
const CSV_COLUMNS = [
  { key: 'id', label: 'id' }, { key: 'name', label: 'nombre' }, { key: 'phone', label: 'telefono' },
  { key: 'email', label: 'email' }, { key: 'companyName', label: 'empresa' }, { key: 'program', label: 'programa' },
  { key: 'city', label: 'ciudad' }, { key: 'notes', label: 'notas' }, { key: 'ownerEmail', label: 'responsable' },
  { key: 'createdAt', label: 'creado' },
];

router.get('/export.csv', requireAdmin, ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, co.name AS company_name, u.email AS owner_email FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id LEFT JOIN users u ON u.id = c.assigned_to
      ORDER BY c.created_at`,
  );
  const data = rows.map((r) => ({ ...mapContact(r), companyName: r.company_name, ownerEmail: r.owner_email }));
  await audit({ by: req.user, action: 'backup', entityType: 'contacto', detail: `Exportación CSV de ${data.length} contactos` });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="contactos.csv"');
  res.send(toCSV(data, CSV_COLUMNS));
}));

const pick = (row, ...keys) => {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === k);
    if (found && row[found]) return row[found];
  }
  return null;
};

router.post('/import', requireAdmin, ah(async (req, res) => {
  const { csv } = parse(z.object({ csv: z.string().min(1).max(20_000_000) }), req.body);
  const records = parseCSV(csv);
  const result = await db.tx(async (client) => {
    const users = (await client.query('SELECT id, email, username, name FROM users')).rows;
    const companies = (await client.query('SELECT id, name FROM companies')).rows;
    let created = 0;
    let skipped = 0;
    const errors = [];
    for (const [i, r] of records.entries()) {
      const name = pick(r, 'nombre', 'name');
      if (!name) { skipped++; errors.push(`Fila ${i + 2}: sin nombre`); continue; }
      const owner = pick(r, 'responsable', 'assignedto', 'asesor');
      const ownerUser = owner && users.find((u) => [u.email, u.username, u.name, u.id].some((v) => v && v.toLowerCase() === owner.toLowerCase()));
      const companyName = pick(r, 'empresa', 'company');
      let company = companyName && companies.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
      if (companyName && !company) {
        company = { id: newId('co'), name: companyName };
        await client.query('INSERT INTO companies (id, name, assigned_to) VALUES ($1, $2, $3)', [company.id, company.name, ownerUser?.id || req.user.id]);
        companies.push(company);
      }
      let prog = pick(r, 'programa', 'program');
      if (prog && !PROGRAMS.includes(prog)) {
        const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        prog = PROGRAMS.find((p) => norm(p) === norm(prog)) || null;
      }
      await client.query(
        `INSERT INTO contacts (id, name, phone, email, company_id, program, city, notes, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newId('c'), name, pick(r, 'telefono', 'phone'), pick(r, 'email', 'correo'), company?.id || null, prog,
          pick(r, 'ciudad', 'city'), pick(r, 'notas', 'notes'), ownerUser?.id || req.user.id],
      );
      created++;
    }
    await audit({ client, by: req.user, action: 'importación', entityType: 'contacto', detail: `CSV: ${created} creados, ${skipped} omitidos` });
    return { created, skipped, errors };
  });
  realtime.notifyChange('all');
  res.json(result);
}));

module.exports = router;
