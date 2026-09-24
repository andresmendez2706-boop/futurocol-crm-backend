'use strict';

const { Pool, types } = require('pg');
const config = require('./config');

// DATE → 'YYYY-MM-DD' tal cual (sin conversión a zona horaria); NUMERIC → number.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX || 10) });

function query(text, params) {
  return pool.query(text, params);
}

// Ejecuta fn(client) dentro de una transacción.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
