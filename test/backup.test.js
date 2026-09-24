'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed, login } = require('./helpers');

let s;
before(async () => { s = await seed(); });
after(() => db.pool.end());

// Backup con la forma del CRM anterior (localStorage): contraseñas en btoa, ids propios,
// historial de etapas, bitácora y auditoría.
const legacy = {
  users: [
    { id: 'u1', name: 'Laura Legacy', username: 'laura', passwordHash: Buffer.from('clave-vieja').toString('base64'), role: 'asesor', email: 'laura@futurocol.test', commissionRate: 8, createdAt: '2025-01-10T10:00:00.000Z' },
    { id: 'u2', name: 'Sin Correo', username: 'sincorreo', passwordHash: Buffer.from('otra-clave').toString('base64'), role: 'asesor' },
  ],
  companies: [{ id: 'co1', name: 'ACME', nit: '900', assignedTo: 'u1', createdAt: 1736503200000, campoRaro: 'x' }],
  contacts: [
    { id: 'c1', name: 'Pedro', phone: '3001234567', companyId: 'co1', program: 'Ciberseguridad', assignedTo: 'u1', createdAt: '2025-02-01T00:00:00.000Z', activity: [{ id: 'a1', type: 'llamada', text: 'Hola', author: 'Laura Legacy', at: '2025-02-02T00:00:00.000Z' }] },
    { id: 'c2', name: 'Huérfano', assignedTo: 'u_borrado' },
  ],
  deals: [{
    id: 'd1', title: 'Esp. Ciber', contactId: 'c1', value: 12000000, stage: 'ganado', dealType: 'Especialización',
    assignedTo: 'u1', closeDate: '2025-03-01', createdAt: '2025-02-01T00:00:00.000Z',
    stageHistory: [
      { stage: 'prospecto', from: null, at: '2025-02-01T00:00:00.000Z', by: 'Laura Legacy' },
      { stage: 'ganado', from: 'prospecto', at: '2025-03-01T00:00:00.000Z', by: 'Laura Legacy' },
    ],
  }, { id: 'd2', title: 'Etapa vieja', contactId: 'c1', stage: 'etapa_personalizada', assignedTo: 'u1' }],
  tasks: [{ id: 't1', contactId: 'c1', title: 'Llamar', type: 'llamada', dueDate: '2025-02-05', done: false, assignedTo: 'u1', autoRule: 'lead_c1' }],
  messages: [{ id: 'm1', from: 'u1', to: 'u_admin', text: 'Hola jefe', at: '2025-02-03T00:00:00.000Z' }],
  auditLog: [{ id: 'l1', at: '2025-02-01T00:00:00.000Z', by: 'Laura Legacy', action: 'creación', entityType: 'contacto', entityLabel: 'Pedro', detail: '' }],
  stages: [{ id: 'prospecto', label: 'Lead nuevo' }, { id: 'etapa_personalizada', label: 'Personalizada' }, { id: 'ganado', label: 'Cierre ganado' }],
  commissions: { adminDefault: 3, asesorScales: [5, 8, 10] },
};

test('importa el backup del CRM anterior sin perder historial', async () => {
  const r = await s.admin.post('/api/admin/backup/import', { data: legacy, mode: 'merge' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stats.deals.inserted, 2);
  assert.equal(r.body.stats.auditLog.inserted, 1);
  assert.ok(r.body.warnings.some((w) => /Sin Correo/.test(w)));

  const deal = (await s.admin.get('/api/deals')).body.find((d) => d.id === 'd1');
  assert.equal(deal.stageHistory.length, 2);
  assert.equal(deal.value, 12000000);
  assert.equal(deal.closeDate, '2025-03-01');
  const contact = (await s.admin.get('/api/contacts')).body.find((c) => c.id === 'c1');
  assert.equal(contact.activity[0].text, 'Hola');
  assert.equal(contact.companyId, 'co1');

  // Responsable inexistente → queda a nombre de quien importa (nunca huérfano)
  const orphan = (await db.query("SELECT assigned_to FROM contacts WHERE id = 'c2'")).rows[0];
  assert.equal(orphan.assigned_to, 'u_admin');
  // Campos desconocidos se conservan
  const co = (await db.query("SELECT extra FROM companies WHERE id = 'co1'")).rows[0];
  assert.equal(co.extra.campoRaro, 'x');
  // Etapas desconocidas se agregan para no perder negocios
  const stages = (await s.admin.get('/api/settings')).body.stages;
  assert.ok(stages.some((x) => x.id === 'etapa_personalizada'));
  // Auditoría original conservada
  const audit = (await s.admin.get('/api/admin/audit')).body.entries;
  assert.ok(audit.some((a) => a.id === 'l1'));
  assert.ok(audit.some((a) => a.action === 'importación'));
});

test('contraseñas btoa del CRM anterior se convierten a bcrypt y siguen funcionando', async () => {
  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = 'u1'");
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  const laura = await login('laura@futurocol.test', 'clave-vieja');
  const mine = (await laura.get('/api/contacts')).body;
  assert.deepEqual(mine.map((c) => c.id), ['c1']);
});

test('importar dos veces no duplica (fusionar)', async () => {
  const r = await s.admin.post('/api/admin/backup/import', { data: legacy, mode: 'merge' });
  assert.equal(r.body.stats.deals.inserted, 0);
  assert.equal(r.body.stats.deals.skipped, 2);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM deals');
  assert.equal(rows[0].n, 2);
});

test('acepta el formato localStorage (colecciones como strings JSON)', async () => {
  const ls = { crm_contacts: JSON.stringify([{ id: 'c9', name: 'Desde LS', assignedTo: 'u1' }]), crm_deals: '[]' };
  const r = await s.admin.post('/api/admin/backup/import', { data: ls, mode: 'merge' });
  assert.equal(r.body.stats.contacts.inserted, 1);
});

test('exportar y restaurar (reemplazar) conserva todo; la auditoría nunca se borra', async () => {
  const backup = (await s.admin.get('/api/admin/backup')).body;
  assert.equal(backup.deals.length, 2);
  assert.ok(backup.users.every((u) => /^\$2/.test(u.passwordHash)));
  const auditBefore = (await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
  await s.admin.post('/api/contacts', { name: 'Se borrará al restaurar' });
  const r = await s.admin.post('/api/admin/backup/import', { data: backup, mode: 'replace' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const names = (await s.admin.get('/api/contacts')).body.map((c) => c.name);
  assert.ok(!names.includes('Se borrará al restaurar'));
  assert.equal((await s.admin.get('/api/deals')).body.find((d) => d.id === 'd1').stageHistory.length, 2);
  const auditAfter = (await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
  assert.ok(auditAfter > auditBefore);
  // tras restaurar, las contraseñas bcrypt del backup siguen sirviendo
  await login('laura@futurocol.test', 'clave-vieja');
});
