'use strict';

// Uso: npm run create-admin -- --email admin@futurocol.com --password "********" --name "Nombre"
const { migrate } = require('../migrate');
const { pool } = require('../db');
const { createAdmin } = require('./bootstrap-admin');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const email = arg('email') || process.env.ADMIN_EMAIL;
  const password = arg('password') || process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Uso: npm run create-admin -- --email <correo> --password <contraseña> [--name <nombre>]');
  await migrate();
  await createAdmin({ email, password, name: arg('name') || 'Administrador', username: arg('username') });
  console.log(`Administrador creado: ${email}`);
})().then(() => pool.end()).catch(async (err) => {
  console.error(err.message);
  await pool.end();
  process.exit(1);
});
