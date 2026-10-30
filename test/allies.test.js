'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');

let s;
let unir;
before(async () => {
  s = await seed();
  await db.query("UPDATE allies SET commission_rate = 25 WHERE id = 'ally_cun'");
});
after(() => db.pool.end());

test('el admin crea un aliado con su % y sus programas; el asesor no puede', async () => {
  assert.equal((await s.a1.post('/api/settings/allies', { name: 'X', commissionRate: 10 })).status, 403);
  const r = await s.admin.post('/api/settings/allies', { name: 'UNIR', commissionRate: 20, programs: ['Máster en Marketing Digital', 'Máster en IA', 'Máster en IA'] });
  assert.equal(r.status, 201);
  unir = r.body;
  assert.deepEqual(unir.programs, ['Máster en Marketing Digital', 'Máster en IA']);
  const boot = (await s.a1.get('/api/bootstrap')).body;
  assert.deepEqual(boot.settings.allies.map((a) => a.name), ['CUN', 'UNIR']);
});

test('el asesor solo vende los aliados asignados; el programa debe ser del aliado', async () => {
  await s.admin.patch('/api/users/u_a2', { allyIds: [unir.id] });
  // a2 solo vende UNIR: sin indicar aliado queda en UNIR; no puede crear en CUN
  const c = (await s.a2.post('/api/contacts', { name: 'Lead UNIR', program: 'Máster en IA' })).body;
  assert.equal(c.allyId, unir.id);
  assert.equal((await s.a2.post('/api/contacts', { name: 'X', allyId: 'ally_cun' })).status, 403);
  // programa de otra universidad → rechazado
  assert.equal((await s.a2.post('/api/contacts', { name: 'Y', program: 'Ciberseguridad' })).status, 400);
  // el negocio hereda el aliado del contacto
  const d = (await s.a2.post('/api/deals', { title: 'Máster IA', contactId: c.id, value: 10000000, product: 'Máster en IA' })).body;
  assert.equal(d.allyId, unir.id);
  await s.a2.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  // a1 vende todos (sin asignación): sin indicar aliado queda en el primero (CUN)
  const c1 = (await s.a1.post('/api/contacts', { name: 'Lead CUN', program: 'Ciberseguridad' })).body;
  assert.equal(c1.allyId, 'ally_cun');
  const d1 = (await s.a1.post('/api/deals', { title: 'Esp. Ciber', contactId: c1.id, value: 4000000 })).body;
  await s.a1.patch(`/api/deals/${d1.id}`, { stage: 'ganado' });
});

test('ganancia de Futurocol = % de cada aliado × su facturación; vista por aliado y unificada', async () => {
  // CUN: 4M × 25% = 1M · UNIR: 10M × 20% = 2M → Futurocol 3M
  const all = (await s.admin.get('/api/stats/dashboard?type=all')).body;
  assert.equal(all.cards.billing, 14000000);
  assert.equal(all.cards.adminCommission, 3000000);
  assert.deepEqual(all.cards.byAlly.map((a) => [a.name, a.billing, a.earnings]), [['CUN', 4000000, 1000000], ['UNIR', 10000000, 2000000]]);

  const onlyUnir = (await s.admin.get(`/api/stats/dashboard?type=all&ally=${unir.id}`)).body;
  assert.equal(onlyUnir.cards.billing, 10000000);
  assert.equal(onlyUnir.cards.adminCommission, 2000000);
  assert.equal(onlyUnir.cards.contacts, 1);

  const year = new Date().getFullYear();
  await s.admin.post('/api/admin/expenses', { year, month: new Date().getMonth() + 1, category: 'Marketing', amount: 300000, allyId: unir.id });
  await s.admin.post('/api/admin/expenses', { year, month: new Date().getMonth() + 1, category: 'Planes móviles', amount: 100000 });
  const f = (await s.admin.get('/api/admin/finance?all=1')).body;
  const cun = f.byAlly.find((a) => a.name === 'CUN');
  const un = f.byAlly.find((a) => a.name === 'UNIR');
  assert.equal(cun.gross, 1000000);
  assert.equal(cun.commission, 400000); // 10% de 4M (a1)
  assert.equal(un.gross, 2000000);
  assert.equal(un.commission, 500000); // 5% de 10M (a2)
  assert.equal(un.expenses, 300000);
  assert.equal(un.net, 1200000);
  // Unificado: 3M − 0,9M comisiones − 0,4M gastos (incluye el gasto general)
  assert.equal(f.totals.adminGross, 3000000);
  assert.equal(f.totals.net, 1700000);
  const fu = (await s.admin.get(`/api/admin/finance?all=1&ally=${unir.id}`)).body;
  assert.equal(fu.totals.adminGross, 2000000);
  assert.equal(fu.totals.expensesTotal, 300000); // solo gastos de UNIR
});

test('cambiar el % de un aliado queda en la auditoría y la copia de seguridad incluye los aliados', async () => {
  await s.admin.patch(`/api/settings/allies/${unir.id}`, { commissionRate: 22 });
  const { rows } = await db.query("SELECT detail FROM audit_log WHERE entity_type = 'aliado' AND action = 'cambio de comisión'");
  assert.match(rows[0].detail, /20 → 22/);
  const backup = (await s.admin.get('/api/admin/backup')).body;
  assert.equal(backup.allies.length, 2);
  assert.ok(backup.deals.every((d) => d.allyId));
});
