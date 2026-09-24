'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { app, request, db, seed, login } = require('./helpers');

let s;
before(async () => { s = await seed(); });
after(() => db.pool.end());

test('contraseñas guardadas con bcrypt (no btoa)', async () => {
  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = 'u_a1'");
  assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  assert.ok(await bcrypt.compare('password123', rows[0].password_hash));
});

test('login con correo; credenciales inválidas → 401; login queda en auditoría', async () => {
  const bad = await request(app).post('/api/auth/login').send({ login: 'a1@futurocol.test', password: 'mala' });
  assert.equal(bad.status, 401);
  const ok = await request(app).post('/api/auth/login').send({ login: 'A1@FUTUROCOL.TEST', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['set-cookie'][0], /HttpOnly/);
  const { rows } = await db.query("SELECT * FROM audit_log WHERE action = 'inicio de sesión'");
  assert.ok(rows.length >= 1);
});

test('sin sesión no hay acceso a la API', async () => {
  const r = await request(app).get('/api/bootstrap');
  assert.equal(r.status, 401);
});

test('peticiones que modifican datos exigen cabecera anti-CSRF', async () => {
  const r = await s.a1.agent.post('/api/contacts').send({ name: 'X' });
  assert.equal(r.status, 403);
});

test('cambio de contraseña invalida sesiones anteriores', async () => {
  const other = await login('a2@futurocol.test');
  const r = await s.a2.post('/api/auth/password', { current: 'password123', next: 'nuevaClave123' });
  assert.equal(r.status, 200);
  assert.equal((await other.get('/api/bootstrap')).status, 401);
  assert.equal((await s.a2.get('/api/bootstrap')).status, 200); // la sesión actual se renueva
  await login('a2@futurocol.test', 'nuevaClave123');
});

test('asesor no accede a rutas de administración', async () => {
  for (const url of ['/api/users', '/api/admin/audit', '/api/admin/reports', '/api/admin/backup', '/api/contacts/export.csv', '/api/admin/source']) {
    assert.equal((await s.a1.get(url)).status, 403, url);
  }
  assert.equal((await s.admin.get('/api/admin/audit')).status, 200);
});
