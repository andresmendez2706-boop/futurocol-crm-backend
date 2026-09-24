'use strict';

// Sincronización multiusuario en tiempo real.
// Cada cambio se publica con pg_notify, de modo que funciona aunque haya varias instancias del
// servidor; cada instancia reenvía el aviso a sus clientes conectados por Server-Sent Events.
// El cliente, al recibir el aviso, vuelve a pedir sus datos (siempre filtrados por permisos),
// por lo que el aviso nunca contiene datos sensibles.

const { Client } = require('pg');
const config = require('./config');
const db = require('./db');

const CHANNEL = 'crm_changes';
const clients = new Set(); // { res, user }
let listener = null;
let heartbeat = null;

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function fanOut(payload) {
  for (const c of clients) {
    // Mensajes: solo interesa a emisor/receptor. Resto: a todos (el cliente recarga su alcance).
    if (payload.users && !payload.users.includes(c.user.id) && c.user.role !== 'admin') continue;
    try {
      send(c.res, 'change', { entity: payload.entity, at: payload.at });
    } catch {
      clients.delete(c);
    }
  }
}

async function start() {
  if (listener) return;
  listener = new Client({ connectionString: config.databaseUrl });
  listener.on('error', (err) => {
    console.error('[realtime] error de conexión LISTEN:', err.message);
    listener = null;
    setTimeout(() => start().catch(() => {}), 5000);
  });
  await listener.connect();
  await listener.query(`LISTEN ${CHANNEL}`);
  listener.on('notification', (msg) => {
    try {
      fanOut(JSON.parse(msg.payload));
    } catch { /* ignorar */ }
  });
  heartbeat = setInterval(() => {
    for (const c of clients) {
      try { c.res.write(': ping\n\n'); } catch { clients.delete(c); }
    }
  }, 25000);
  heartbeat.unref();
}

async function stop() {
  clearInterval(heartbeat);
  for (const c of clients) c.res.end();
  clients.clear();
  if (listener) {
    const l = listener;
    listener = null;
    await l.end().catch(() => {});
  }
}

// Notifica un cambio. `users` (opcional) limita el aviso a esos usuarios (+ admins).
function notifyChange(entity, users) {
  const payload = JSON.stringify({ entity, users, at: Date.now() });
  db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch((err) =>
    console.error('[realtime] no se pudo notificar:', err.message));
}

function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const entry = { res, user: req.user };
  clients.add(entry);
  send(res, 'hello', { userId: req.user.id });
  req.on('close', () => clients.delete(entry));
}

module.exports = { start, stop, notifyChange, sseHandler };
