'use strict';

// Migración inicial: importa el backup .json del CRM anterior.
// Uso: npm run import-backup -- ruta/backup.json [--mode merge|replace] [--as admin@correo.com]
const fs = require('fs');
const { migrate } = require('../migrate');
const { pool, query } = require('../db');
const { importBackup } = require('../services/backup');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('Uso: npm run import-backup -- <archivo.json> [--mode merge|replace] [--as correo-admin]');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  await migrate();
  const as = arg('as');
  const { rows } = as
    ? await query("SELECT * FROM users WHERE lower(email) = lower($1) AND role = 'admin'", [as])
    : await query("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  if (!rows[0]) throw new Error('Se necesita un administrador existente (crea uno con `npm run create-admin`).');
  const result = await importBackup(raw, { mode: arg('mode') || 'merge', actor: rows[0] });
  console.log(JSON.stringify(result, null, 2));
})().then(() => pool.end()).catch(async (err) => {
  console.error(err.message);
  await pool.end();
  process.exit(1);
});
