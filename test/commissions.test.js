'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');
const { computeCommissions, taskLight } = require('../src/services/rules');

after(() => db.pool.end());

const users = [
  { id: 'adm', name: 'Admin', role: 'admin', commissionRate: 2 },
  { id: 'a1', name: 'A1', role: 'asesor', commissionRate: 10 },
  { id: 'a2', name: 'A2', role: 'asesor', commissionRate: null }, // usa el valor por defecto
];
const cfg = { adminDefault: 3, asesorDefault: 5, asesorScales: [5, 8, 10] };
const deal = (assignedTo, value, closeDate, stage = 'ganado') => ({ assignedTo, value, closeDate, stage, stageHistory: [] });

test('asesor: su tasa × lo que él cerró; admin: su tasa × facturación TOTAL', () => {
  const deals = [
    deal('a1', 1000, '2026-03-10'),
    deal('a2', 2000, '2026-03-15'),
    deal('adm', 500, '2026-03-20'), // ventas propias del admin
    deal('a1', 9999, '2026-03-20', 'negociacion'), // no ganado: no cuenta
  ];
  const r = computeCommissions({ users, deals, commissions: cfg, period: { type: 'all' } });
  assert.equal(r.totalBilling, 3500);
  assert.equal(r.asesores.find((a) => a.userId === 'a1').commission, 100); // 10% de 1000
  assert.equal(r.asesores.find((a) => a.userId === 'a2').commission, 100); // 5% (defecto) de 2000
  assert.equal(r.asesores.find((a) => a.userId === 'a2').rate, 5);
  const adm = r.admins[0];
  assert.equal(adm.commission, 70); // 2% de 3500 (total), NO de sus 500
  assert.equal(adm.ownBilling, 500);
  assert.equal(r.asesoresTotal, 200);
  assert.equal(r.adminTotal, 70); // se reportan por separado
});

test('filtro de período: mes, año y general', () => {
  const deals = [deal('a1', 1000, '2026-01-05'), deal('a1', 2000, '2026-02-05'), deal('a1', 4000, '2025-02-05')];
  const run = (period) => computeCommissions({ users, deals, commissions: cfg, period });
  assert.equal(run({ type: 'month', year: 2026, month: 2 }).totalBilling, 2000);
  assert.equal(run({ type: 'year', year: 2026 }).totalBilling, 3000);
  assert.equal(run({ type: 'all' }).totalBilling, 7000);
  const adm = run({ type: 'year', year: 2026 }).admins[0];
  assert.deepEqual(adm.monthly.map((m) => [m.month, m.commission]), [['2026-01', 20], ['2026-02', 40]]);
});

test('semáforo de tareas', () => {
  const today = '2026-05-10';
  assert.equal(taskLight({ dueDate: '2026-05-09', done: false }, today), 'rojo');
  assert.equal(taskLight({ dueDate: '2026-05-10', done: false }, today), 'amarillo');
  assert.equal(taskLight({ dueDate: '2026-05-11', done: false }, today), 'amarillo');
  assert.equal(taskLight({ dueDate: '2026-05-12', done: false }, today), 'verde');
  assert.equal(taskLight({ dueDate: '2026-05-01', done: true }, today), 'verde');
});

test('cambiar la tasa de un asesor no afecta la del admin ni la de otros (API + panel)', async () => {
  const s = await seed();
  const c = (await s.a1.post('/api/contacts', { name: 'C' })).body;
  const c2 = (await s.a2.post('/api/contacts', { name: 'C2' })).body;
  const d1 = (await s.a1.post('/api/deals', { title: 'd1', contactId: c.id, value: 1000000 })).body;
  const d2 = (await s.a2.post('/api/deals', { title: 'd2', contactId: c2.id, value: 3000000 })).body;
  await s.a1.patch(`/api/deals/${d1.id}`, { stage: 'ganado' });
  await s.a2.patch(`/api/deals/${d2.id}`, { stage: 'ganado' });

  let panel = (await s.admin.get('/api/stats/dashboard?type=all')).body;
  assert.equal(panel.cards.billing, 4000000);
  assert.equal(panel.cards.asesoresCommission, 100000 + 150000); // 10% de 1M + 5% de 3M
  assert.equal(panel.cards.adminCommission, 80000); // 2% de 4M
  assert.ok(panel.cards.weightedPipeline !== undefined);

  const r = await s.admin.patch('/api/users/u_a1', { commissionRate: 8 });
  assert.equal(r.status, 200);
  panel = (await s.admin.get('/api/stats/dashboard?type=all')).body;
  assert.equal(panel.perAsesor.find((p) => p.userId === 'u_a1').commission, 80000);
  assert.equal(panel.perAsesor.find((p) => p.userId === 'u_a2').commission, 150000);
  assert.equal(panel.cards.adminCommission, 80000);
  const { rows } = await db.query("SELECT * FROM audit_log WHERE action = 'cambio de comisión'");
  assert.equal(rows.length, 1);

  // El asesor ve solo su comisión; ni pipeline ponderado ni comisión del admin.
  const mine = (await s.a2.get('/api/stats/dashboard?type=all')).body;
  assert.equal(mine.cards.myCommission, 150000);
  assert.equal(mine.cards.billing, 3000000);
  assert.equal(mine.cards.weightedPipeline, undefined);
  assert.equal(mine.cards.adminCommission, undefined);
  assert.equal(mine.perAsesor, null);

  // Asesor no puede cambiar comisiones
  assert.equal((await s.a1.patch('/api/users/u_a1', { commissionRate: 50 })).status, 403);
});
