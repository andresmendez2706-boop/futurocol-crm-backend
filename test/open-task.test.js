'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');
const { runAutomations } = require('../src/services/automations');

let s;
let contact;
let deal;
before(async () => {
  s = await seed();
  contact = (await s.a1.post('/api/contacts', { name: 'Único' })).body;
  deal = (await s.a1.post('/api/deals', { title: 'Maestría', contactId: contact.id })).body;
});
after(() => db.pool.end());

test('no se puede crear una segunda tarea pendiente en el mismo contacto', async () => {
  const t1 = await s.a1.post('/api/tasks', { title: 'Llamar', contactId: contact.id, dueDate: '2030-01-01' });
  assert.equal(t1.status, 201);
  const t2 = await s.a1.post('/api/tasks', { title: 'Otra', contactId: contact.id });
  assert.equal(t2.status, 409);
  assert.equal(t2.body.code, 'OPEN_TASK_EXISTS');
  assert.equal(t2.body.openTask.id, t1.body.id);
  // Tampoco a través del negocio del mismo contacto (se liga al contacto del negocio)
  const t3 = await s.a1.post('/api/tasks', { title: 'Por negocio', dealId: deal.id });
  assert.equal(t3.status, 409);
  // El admin tampoco puede duplicar
  assert.equal((await s.admin.post('/api/tasks', { title: 'Admin', contactId: contact.id, assignedTo: 'u_a1' })).status, 409);

  // Al completar la tarea abierta, ya se puede programar la siguiente
  await s.a1.patch(`/api/tasks/${t1.body.id}`, { done: true });
  const next = await s.a1.post('/api/tasks', { title: 'Seguimiento', dealId: deal.id, dueDate: '2030-02-01' });
  assert.equal(next.status, 201);
  assert.equal(next.body.contactId, contact.id);

  // Reabrir la anterior duplicaría: se rechaza
  const reopen = await s.a1.patch(`/api/tasks/${t1.body.id}`, { done: false });
  assert.equal(reopen.status, 409);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM tasks WHERE done = false AND contact_id = $1', [contact.id]);
  assert.equal(rows[0].n, 1);
});

test('mover una tarea a un contacto que ya tiene una pendiente se rechaza', async () => {
  const other = (await s.a1.post('/api/contacts', { name: 'Otro' })).body;
  const t = (await s.a1.post('/api/tasks', { title: 'X', contactId: other.id })).body;
  assert.equal((await s.a1.patch(`/api/tasks/${t.id}`, { contactId: contact.id })).status, 409);
  assert.equal((await s.a1.patch(`/api/tasks/${t.id}`, { title: 'X editada' })).status, 200);
});

test('peticiones simultáneas no crean dos tareas abiertas', async () => {
  const c = (await s.a2.post('/api/contacts', { name: 'Carrera' })).body;
  const results = await Promise.all([1, 2, 3, 4].map((i) => s.a2.post('/api/tasks', { title: `T${i}`, contactId: c.id })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 3);
});

test('las automatizaciones no crean tarea si el contacto ya tiene una pendiente', async () => {
  const c = (await s.a2.post('/api/contacts', { name: 'Con tarea' })).body;
  await s.a2.post('/api/tasks', { title: 'Manual', contactId: c.id });
  await db.query("UPDATE contacts SET created_at = now() - interval '5 days' WHERE id = $1", [c.id]);
  await runAutomations();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM tasks WHERE contact_id = $1', [c.id]);
  assert.equal(rows[0].n, 1);
});
