'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');

let s;
before(async () => { s = await seed(); });
after(() => db.pool.end());

const stagesOf = async (c) => (await c.get('/api/settings')).body.stages;

test('admin agrega, renombra y reordena etapas; las protegidas siempre quedan', async () => {
  const cur = await stagesOf(s.admin);
  const open = cur.filter((x) => !x.protected);
  const next = [
    { ...open[1] }, { ...open[0], label: 'Prospecto' }, ...open.slice(2),
    { label: 'Matriculado', probability: 90 },
    { id: 'ganado', label: 'Ganado 🎉' },
  ]; // se omiten aplazado/perdido a propósito
  const r = await s.admin.put('/api/settings/stages', { stages: next });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ids = r.body.stages.map((x) => x.id);
  assert.equal(ids[0], 'contactado');
  assert.equal(ids[1], 'prospecto');
  assert.ok(ids.includes('matriculado'));
  assert.deepEqual(ids.slice(-3), ['aplazado', 'ganado', 'perdido']);
  assert.equal(r.body.stages.find((x) => x.id === 'ganado').label, 'Ganado 🎉');
  assert.equal(r.body.stages.find((x) => x.id === 'ganado').probability, 100);
});

test('eliminar una etapa con negocios exige moverlos', async () => {
  const c = (await s.a1.post('/api/contacts', { name: 'C' })).body;
  const d = (await s.a1.post('/api/deals', { title: 'D', contactId: c.id })).body;
  await s.a1.patch(`/api/deals/${d.id}`, { stage: 'matriculado' });
  const without = (await stagesOf(s.admin)).filter((x) => x.id !== 'matriculado');
  const r = await s.admin.put('/api/settings/stages', { stages: without });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'STAGE_IN_USE');
  const ok = await s.admin.put('/api/settings/stages', { stages: without, moveDeals: { matriculado: 'negociacion' } });
  assert.equal(ok.status, 200);
  const moved = (await s.a1.get('/api/deals')).body.find((x) => x.id === d.id);
  assert.equal(moved.stage, 'negociacion');
  assert.equal(moved.stageHistory.at(-1).from, 'matriculado');
});

test('no se permiten dos etapas con el mismo nombre', async () => {
  const cur = await stagesOf(s.admin);
  const r = await s.admin.put('/api/settings/stages', { stages: [...cur, { label: 'contactado' }] });
  assert.equal(r.status, 400);
});

test('asesor no puede cambiar la configuración', async () => {
  assert.equal((await s.a1.put('/api/settings/stages', { stages: [{ label: 'x' }] })).status, 403);
  assert.equal((await s.a1.put('/api/settings/commissions', { adminDefault: 1, asesorDefault: 1, asesorScales: [] })).status, 403);
});

test('comisiones por defecto configurables; aplican a usuarios sin tasa propia', async () => {
  const r = await s.admin.put('/api/settings/commissions', { adminDefault: 4, asesorDefault: 7, asesorScales: [10, 5, 8, 5] });
  assert.deepEqual(r.body.asesorScales, [5, 8, 10]);
  await s.admin.patch('/api/users/u_a2', { commissionRate: null });
  const users = (await s.admin.get('/api/users')).body;
  assert.equal(users.find((u) => u.id === 'u_a2').commissionRate, null);
  assert.equal(users.find((u) => u.id === 'u_a1').commissionRate, 10);
  const panel = (await s.admin.get('/api/stats/dashboard')).body;
  assert.equal(panel.perAsesor.find((p) => p.userId === 'u_a2').rate, 7);
  assert.equal(panel.perAsesor.find((p) => p.userId === 'u_a1').rate, 10);
});

test('usuarios: correo obligatorio, válido y único', async () => {
  const base = { name: 'N', username: 'nuevo', role: 'asesor', password: 'password123' };
  assert.equal((await s.admin.post('/api/users', base)).status, 400);
  assert.equal((await s.admin.post('/api/users', { ...base, email: 'no-es-correo' })).status, 400);
  assert.equal((await s.admin.post('/api/users', { ...base, email: 'A1@futurocol.test' })).status, 409);
  const ok = await s.admin.post('/api/users', { ...base, email: 'nuevo@futurocol.test', commissionRate: 8 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.commissionRate, 8);
});
