'use strict';

const db = require('../db');
const { hashPassword } = require('../auth');
const { newId } = require('../util');

// Si la base está vacía y existen ADMIN_EMAIL / ADMIN_PASSWORD, crea el primer administrador.
async function ensureInitialAdmin() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[inicio] No hay usuarios. Crea el primer admin con `npm run create-admin` o define ADMIN_EMAIL y ADMIN_PASSWORD.');
    return;
  }
  await createAdmin({ email, password, name: process.env.ADMIN_NAME || 'Administrador' });
  console.log(`[inicio] Administrador inicial creado: ${email}`);
}

async function createAdmin({ email, password, name, username }) {
  if (String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  const user = username || email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '');
  await db.query(
    `INSERT INTO users (id, name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, 'admin')`,
    [newId('u'), name, user, email.toLowerCase(), await hashPassword(password)],
  );
}

module.exports = { ensureInitialAdmin, createAdmin };
