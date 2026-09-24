'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');

let s;
let c1;
let c2;
before(async () => {
  s = await seed();
  c1 = (await s.a1.post('/api/contacts', { name: 'Lead de A1', email: 'l1@x.com' })).body;
  c2 = (await s.a2.post('/api/contacts', { name: 'Lead de A2', phone: '+57 300 111 2233' })).body;
});
after(() => db.pool.end());

test('lo creado por un asesor queda asignado a él', () => {
  assert.equal(c1.assignedTo, 'u_a1');
  assert.equal(c2.assignedTo, 'u_a2');
});

test('asesor solo ve lo suyo; admin ve todo', async () => {
  const a1 = (await s.a1.get('/api/contacts')).body;
  assert.deepEqual(a1.map((c) => c.id), [c1.id]);
  const admin = (await s.admin.get('/api/contacts')).body;
  assert.equal(admin.length, 2);
});

test('asesor no puede editar registros ajenos (validado en el servidor)', async () => {
  const r = await s.a1.patch(`/api/contacts/${c2.id}`, { name: 'hack' });
  assert.equal(r.status, 403);
  const ok = await s.admin.patch(`/api/contacts/${c2.id}`, { city: 'Bogotá' });
  assert.equal(ok.status, 200);
});

test('asesor no puede asignarse registros a otros ni eliminar', async () => {
  assert.equal((await s.a1.post('/api/contacts', { name: 'X', assignedTo: 'u_a2' })).status, 403);
  assert.equal((await s.a1.del(`/api/contacts/${c1.id}`)).status, 403);
});

test('asesor no puede mover negocios ajenos; admin sí', async () => {
  const deal = (await s.a2.post('/api/deals', { title: 'Maestría A2', contactId: c2.id, value: 1000 })).body;
  assert.equal((await s.a1.patch(`/api/deals/${deal.id}`, { stage: 'contactado' })).status, 403);
  assert.equal((await s.admin.patch(`/api/deals/${deal.id}`, { stage: 'contactado' })).status, 200);
});

test('asesor no puede crear negocios sobre contactos ajenos', async () => {
  const r = await s.a1.post('/api/deals', { title: 'X', contactId: c2.id });
  assert.equal(r.status, 403);
});

test('tareas: admin las ve todas pero no modifica las ajenas', async () => {
  const t = (await s.a1.post('/api/tasks', { title: 'Llamar', contactId: c1.id, type: 'llamada', dueDate: '2030-01-01' })).body;
  const all = (await s.admin.get('/api/tasks')).body;
  assert.ok(all.some((x) => x.id === t.id));
  assert.equal((await s.admin.patch(`/api/tasks/${t.id}`, { done: true })).status, 403);
  assert.equal((await s.a2.get('/api/tasks')).body.length, 0);
  const done = await s.a1.patch(`/api/tasks/${t.id}`, { done: true });
  assert.equal(done.body.done, true);
  assert.ok(done.body.completedAt);
});

test('detección de duplicados por email o teléfono (solo dígitos): advierte pero permite crear', async () => {
  const dup = (await s.a1.post('/api/contacts/check-duplicates', { phone: '300-111-2233' })).body.duplicates;
  assert.equal(dup.length, 1);
  assert.equal(dup[0].id, null); // es de otro asesor: no se exponen sus datos
  const created = await s.a1.post('/api/contacts', { name: 'Otro', email: 'L1@X.com' });
  assert.equal(created.status, 201);
  assert.equal(created.body.duplicates.length, 1);
  assert.equal(created.body.duplicates[0].match, 'email');
});

test('la tasa de comisión de otros usuarios no se expone al asesor', async () => {
  const users = (await s.a1.get('/api/bootstrap')).body.users;
  assert.equal(users.find((u) => u.id === 'u_a2').commissionRate, undefined);
  assert.equal(users.find((u) => u.id === 'u_a1').commissionRate, 10);
});

test('eliminar usuario reasigna todos sus registros a quien lo elimina', async () => {
  const r = await s.admin.del('/api/users/u_a2');
  assert.equal(r.status, 200);
  assert.ok(r.body.reassigned.contacts >= 1);
  const { rows } = await db.query("SELECT count(*)::int AS n FROM contacts WHERE assigned_to = 'u_a2'");
  assert.equal(rows[0].n, 0);
  const moved = await db.query('SELECT assigned_to FROM contacts WHERE id = $1', [c2.id]);
  assert.equal(moved.rows[0].assigned_to, 'u_admin');
});

test('la auditoría es inmutable incluso a nivel de base de datos', async () => {
  await assert.rejects(db.query("UPDATE audit_log SET detail = 'x'"), /solo lectura/);
  await assert.rejects(db.query('DELETE FROM audit_log'), /solo lectura/);
});
