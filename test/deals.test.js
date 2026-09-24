'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');
const { todayISO } = require('../src/util');

let s;
let contact;
before(async () => {
  s = await seed();
  contact = (await s.a1.post('/api/contacts', { name: 'Carlos' })).body;
});
after(() => db.pool.end());

test('negocio nuevo empieza en "Lead nuevo" con historial inicial', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'Esp. IA', contactId: contact.id, value: 5000000, dealType: 'Especialización', product: 'Inteligencia Artificial' })).body;
  assert.equal(d.stage, 'prospecto');
  assert.equal(d.stageHistory.length, 1);
  assert.equal(d.stageHistory[0].from, null);
  assert.equal(d.stageHistory[0].by, 'Andrés Asesor');
});

test('cambio de etapa registra historial {stage, from, at, by}', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'D', contactId: contact.id })).body;
  const r = (await s.a1.patch(`/api/deals/${d.id}`, { stage: 'propuesta' })).body;
  const h = r.stageHistory.at(-1);
  assert.equal(h.stage, 'propuesta');
  assert.equal(h.from, 'prospecto');
  assert.equal(h.by, 'Andrés Asesor');
  assert.ok(Date.parse(h.at));
  const log = await db.query("SELECT * FROM audit_log WHERE action = 'cambio de etapa' AND entity_label = 'D'");
  assert.equal(log.rows.length, 1);
});

test('mover a perdido sin motivo se rechaza; con motivo registra fecha de cierre', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'P', contactId: contact.id })).body;
  const no = await s.a1.patch(`/api/deals/${d.id}`, { stage: 'perdido' });
  assert.equal(no.status, 422);
  assert.equal(no.body.code, 'LOSS_REASON_REQUIRED');
  const cur = (await s.a1.get('/api/deals')).body.find((x) => x.id === d.id);
  assert.equal(cur.stage, 'prospecto');
  const ok = (await s.a1.patch(`/api/deals/${d.id}`, { stage: 'perdido', lossReason: 'Precio' })).body;
  assert.equal(ok.stage, 'perdido');
  assert.equal(ok.lossReason, 'Precio');
  assert.equal(ok.closeDate, todayISO());
  const log = await db.query("SELECT * FROM audit_log WHERE action = 'cierre perdido'");
  assert.equal(log.rows.length, 1);
});

test('si ya tiene motivo, puede pasar a perdido sin pedirlo otra vez', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'P2', contactId: contact.id, lossReason: 'Sin presupuesto' })).body;
  const r = await s.a1.patch(`/api/deals/${d.id}`, { stage: 'perdido' });
  assert.equal(r.status, 200);
});

test('mover a ganado registra fecha de cierre automática', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'G', contactId: contact.id, value: 100 })).body;
  const r = (await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' })).body;
  assert.equal(r.closeDate, todayISO());
});

test('etapa inexistente → 400', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'X', contactId: contact.id })).body;
  assert.equal((await s.a1.patch(`/api/deals/${d.id}`, { stage: 'inventada' })).status, 400);
});

test('la base de datos también impide un perdido sin motivo', async () => {
  await assert.rejects(
    db.query("INSERT INTO deals (id, title, stage, assigned_to) VALUES ('dx', 'x', 'perdido', 'u_a1')"),
    /deals_loss_reason_required/,
  );
});

test('solo el admin elimina negocios', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'Del', contactId: contact.id })).body;
  assert.equal((await s.a1.del(`/api/deals/${d.id}`)).status, 403);
  assert.equal((await s.admin.del(`/api/deals/${d.id}`)).status, 200);
});
