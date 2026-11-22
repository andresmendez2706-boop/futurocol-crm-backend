'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, seed } = require('./helpers');

let s;
test.before(async () => { s = await seed(); });
test.after(() => db.pool.end());

test('detecta leads duplicados por teléfono (con o sin +57) y por correo', async () => {
  const a = (await s.a1.post('/api/contacts', { name: 'Ana', phone: '+57 300 123 4567' })).body;
  const b = (await s.a1.post('/api/contacts', { name: 'Ana P.', phone: '3001234567', email: 'ana@x.com' })).body;
  const c = (await s.a2.post('/api/contacts', { name: 'Ana Pérez', email: ' ANA@x.com ' })).body;
  await s.a2.post('/api/contacts', { name: 'Otra persona', phone: '3109998877', email: 'otra@x.com' });

  // Admin: un solo grupo (A=B por teléfono, B=C por correo) con los tres contactos.
  const groups = (await s.admin.get('/api/contacts/duplicates')).body;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].contacts.map((x) => x.id).sort(), [a.id, b.id, c.id].sort());
  assert.deepEqual(groups[0].matches.sort(), ['correo', 'teléfono']);

  // Viene también en la carga inicial.
  assert.equal((await s.admin.get('/api/bootstrap')).body.duplicates.length, 1);

  // Asesor 2: ve el grupo, pero los contactos de otro asesor van sin datos personales.
  const g2 = (await s.a2.get('/api/contacts/duplicates')).body;
  assert.equal(g2.length, 1);
  const foreign = g2[0].contacts.filter((x) => x.id === null);
  assert.equal(foreign.length, 2);
  assert.ok(foreign.every((x) => x.phone === null && x.email === null && x.owner === 'Andrés Asesor'));
});

test('la importación CSV informa cuántos quedaron como posibles duplicados', async () => {
  const csv = 'nombre,telefono,email\nRepetido,300 123 4567,\nNuevo,3205550000,nuevo@x.com\n';
  const r = (await s.admin.post('/api/contacts/import', { csv })).body;
  assert.equal(r.created, 2);
  assert.equal(r.duplicates, 1);
});
