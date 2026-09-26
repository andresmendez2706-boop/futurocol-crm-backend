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

test('balance financiero: ganancia admin − comisiones de asesores, mes a mes', async () => {
  const s = await seed();
  await db.query("UPDATE users SET commission_rate = 25 WHERE id = 'u_admin'");
  const c1 = (await s.a1.post('/api/contacts', { name: 'X1' })).body;
  const c2 = (await s.a2.post('/api/contacts', { name: 'X2' })).body;
  const d1 = (await s.a1.post('/api/deals', { title: 'd1', contactId: c1.id, value: 10000000 })).body;
  const d2 = (await s.a2.post('/api/deals', { title: 'd2', contactId: c2.id, value: 4000000 })).body;
  await s.a1.patch(`/api/deals/${d1.id}`, { stage: 'ganado' });
  await s.a2.patch(`/api/deals/${d2.id}`, { stage: 'ganado' });
  await db.query("UPDATE deals SET close_date = '2026-03-15' WHERE id = $1", [d2.id]);
  const year = Number((await db.query('SELECT close_date FROM deals WHERE id = $1', [d1.id])).rows[0].close_date.slice(0, 4));
  const month = Number((await db.query('SELECT close_date FROM deals WHERE id = $1', [d1.id])).rows[0].close_date.slice(5, 7));

  assert.equal((await s.a1.get(`/api/admin/finance?year=${year}`)).status, 403);
  const f = (await s.admin.get(`/api/admin/finance?year=${year}`)).body;
  assert.equal(f.adminRate, 25);
  assert.equal(f.months.length, 12);
  const m = f.months[month - 1];
  assert.equal(m.billing, 10000000);
  assert.equal(m.adminGross, 2500000); // 25%
  assert.equal(m.asesoresCommission, 1000000); // 10% de A1
  assert.equal(m.net, 1500000);
  assert.deepEqual(m.asesores.find((a) => a.userId === 'u_a1').dealIds, [d1.id]);
  if (year === 2026) {
    const mar = f.months[2];
    assert.equal(mar.billing, 4000000);
    assert.equal(mar.net, 1000000 - 200000); // 25% de 4M − 5% de 4M
  }
});

test('panel: "Contactos" cuenta solo los leads creados en el período elegido', async () => {
  const s = await seed();
  const old = (await s.a1.post('/api/contacts', { name: 'Viejo' })).body;
  await s.a1.post('/api/contacts', { name: 'Nuevo' });
  await db.query("UPDATE contacts SET created_at = '2025-01-10T12:00:00Z' WHERE id = $1", [old.id]);
  const all = (await s.admin.get('/api/stats/dashboard?type=all')).body;
  assert.equal(all.cards.contacts, 2);
  const jan = (await s.admin.get('/api/stats/dashboard?type=month&year=2025&month=1')).body;
  assert.equal(jan.cards.contacts, 1);
  assert.equal(jan.cards.contactsTotal, 2);
  assert.equal(jan.leadsByStage.reduce((a, x) => a + x.count, 0), 1);
  assert.equal(jan.perAsesor.find((p) => p.userId === 'u_a1').leads, 1);
});

test('gastos de operación: ingreso manual del admin y descuento en el balance', async () => {
  const s = await seed();
  await db.query("UPDATE users SET commission_rate = 25 WHERE id = 'u_admin'");
  const c = (await s.a1.post('/api/contacts', { name: 'G' })).body;
  const d = (await s.a1.post('/api/deals', { title: 'g', contactId: c.id, value: 10000000 })).body;
  await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  await db.query("UPDATE deals SET close_date = '2026-05-10' WHERE id = $1", [d.id]);

  // Solo el admin puede registrar gastos
  assert.equal((await s.a1.post('/api/admin/expenses', { year: 2026, month: 5, category: 'Marketing', amount: 1 })).status, 403);
  assert.equal((await s.admin.post('/api/admin/expenses', { year: 2026, month: 5, category: 'Marketing', amount: -5 })).status, 400);
  const mk = (await s.admin.post('/api/admin/expenses', { year: 2026, month: 5, category: 'Marketing', description: 'Meta Ads', amount: 300000 })).body;
  await s.admin.post('/api/admin/expenses', { year: 2026, month: 5, category: 'Planes móviles', amount: 150000 });

  let m = (await s.admin.get('/api/admin/finance?year=2026')).body.months[4];
  assert.equal(m.adminGross, 2500000);
  assert.equal(m.asesoresCommission, 1000000);
  assert.equal(m.afterCommissions, 1500000);
  assert.equal(m.expensesTotal, 450000);
  assert.equal(m.net, 1050000); // 2.500.000 − 1.000.000 − 450.000

  await s.admin.patch(`/api/admin/expenses/${mk.id}`, { amount: 500000 });
  m = (await s.admin.get('/api/admin/finance?year=2026')).body.months[4];
  assert.equal(m.expensesTotal, 650000);

  // Copiar gastos fijos al mes siguiente
  const cp = (await s.admin.post('/api/admin/expenses/copy', { fromYear: 2026, fromMonth: 5, toYear: 2026, toMonth: 6 })).body;
  assert.equal(cp.copied, 2);
  const f = (await s.admin.get('/api/admin/finance?year=2026')).body;
  assert.equal(f.months[5].expensesTotal, 650000);
  assert.equal(f.months[5].net, -650000); // sin facturación en junio
  assert.equal(f.totals.expensesTotal, 1300000);

  await s.admin.del(`/api/admin/expenses/${mk.id}`);
  assert.equal((await s.admin.get('/api/admin/finance?year=2026')).body.months[4].expensesTotal, 150000);

  // Los gastos viajan en la copia de seguridad
  const backup = (await s.admin.get('/api/admin/backup')).body;
  assert.equal(backup.expenses.length, 3);
  const logs = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'gasto'");
  assert.ok(logs.rows[0].n >= 4);
});
