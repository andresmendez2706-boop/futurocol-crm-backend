'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');
const { createApp } = require('../src/app');
const { migrate } = require('../src/migrate');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const app = createApp();

async function resetDb() {
  await migrate({ log: () => {} });
  await db.query(`TRUNCATE expenses, tasks, deals, contacts, companies, messages, audit_log, settings, automation_log, users CASCADE`);
}

async function createUser({ id, name, email, role = 'asesor', password = 'password123', commissionRate = null }) {
  await db.query(
    `INSERT INTO users (id, name, username, email, password_hash, role, commission_rate) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, name, email.split('@')[0], email, await hashPassword(password), role, commissionRate],
  );
  return { id, name, email, password };
}

// Cliente HTTP autenticado (cookie de sesión + cabecera anti-CSRF).
async function login(email, password = 'password123') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ login: email, password });
  if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
  const wrap = (method) => (url, body) => {
    const r = agent[method](url).set('X-Requested-With', 'XMLHttpRequest');
    return body === undefined ? r : r.send(body);
  };
  return { agent, get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), del: wrap('delete') };
}

// Escenario base: 1 admin + 2 asesores con tasas individuales distintas.
async function seed() {
  await resetDb();
  await createUser({ id: 'u_admin', name: 'Ana Admin', email: 'admin@futurocol.test', role: 'admin', commissionRate: 2 });
  await createUser({ id: 'u_a1', name: 'Andrés Asesor', email: 'a1@futurocol.test', commissionRate: 10 });
  await createUser({ id: 'u_a2', name: 'Beatriz Asesora', email: 'a2@futurocol.test', commissionRate: 5 });
  return {
    admin: await login('admin@futurocol.test'),
    a1: await login('a1@futurocol.test'),
    a2: await login('a2@futurocol.test'),
  };
}

module.exports = { app, request, db, resetDb, createUser, login, seed };
