'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');
const { runAutomations } = require('../src/services/automations');

let s;
before(async () => { s = await seed(); });
after(() => db.pool.end());

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

test('lead 2+ días en "Lead nuevo" sin actividad → tarea "Contactar lead" (sin duplicar)', async () => {
  const idle = (await s.a1.post('/api/contacts', { name: 'Idle' })).body;
  const fresh = (await s.a1.post('/api/contacts', { name: 'Fresh' })).body;
  const active = (await s.a1.post('/api/contacts', { name: 'Active' })).body;
  await db.query('UPDATE contacts SET created_at = $1 WHERE id = ANY($2)', [daysAgo(3), [idle.id, active.id]]);
  await s.a1.post(`/api/contacts/${active.id}/activity`, { type: 'llamada', text: 'Hablamos' });

  const r1 = await runAutomations();
  assert.equal(r1.created, 1);
  const tasks = (await db.query('SELECT * FROM tasks')).rows;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].contact_id, idle.id);
  assert.equal(tasks[0].assigned_to, 'u_a1');
  assert.match(tasks[0].title, /Contactar lead/);
  assert.ok(fresh.id);

  assert.equal((await runAutomations()).created, 0);
  // Aunque se borre la tarea, el mismo disparador no la vuelve a crear.
  await db.query('DELETE FROM tasks');
  assert.equal((await runAutomations()).created, 0);
  const log = await db.query("SELECT * FROM audit_log WHERE action = 'automatización'");
  assert.equal(log.rows.length, 1);
});

test('negocio 48h en "Propuesta enviada" → tarea de seguimiento', async () => {
  const c = (await s.a2.post('/api/contacts', { name: 'Prop' })).body;
  await s.a2.post(`/api/contacts/${c.id}/activity`, { type: 'nota', text: 'x' });
  const d = (await s.a2.post('/api/deals', { title: 'Maestría', contactId: c.id })).body;
  await s.a2.patch(`/api/deals/${d.id}`, { stage: 'propuesta' });
  assert.equal((await runAutomations()).created, 0); // aún no pasan 48h
  const h = (await db.query('SELECT stage_history FROM deals WHERE id = $1', [d.id])).rows[0].stage_history;
  h.at(-1).at = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
  await db.query('UPDATE deals SET stage_history = $1 WHERE id = $2', [JSON.stringify(h), d.id]);
  assert.equal((await runAutomations()).created, 1);
  assert.equal((await runAutomations()).created, 0);
  const t = (await db.query('SELECT * FROM tasks WHERE deal_id = $1', [d.id])).rows[0];
  assert.equal(t.assigned_to, 'u_a2');
  assert.match(t.title, /Seguimiento/);
});
