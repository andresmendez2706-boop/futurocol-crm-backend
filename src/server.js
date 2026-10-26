'use strict';

const express = require('express');
const config = require('./config');
const { createApp } = require('./app');
const { migrate } = require('./migrate');
const realtime = require('./realtime');
const automations = require('./services/automations');
const { ensureInitialAdmin } = require('./cli/bootstrap-admin');
const { pool } = require('./db');

// Estado de la base de datos. El sitio web arranca de inmediato; mientras la base de datos no
// esté lista, responde con una página que explica el motivo (en vez de quedarse cargando).
const status = { ready: false, reason: 'Conectando con la base de datos…', attempts: 0 };

function explain(err) {
  const code = err.code || '';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'No se encuentra el servidor de la base de datos. Revisa que DATABASE_URL tenga la dirección correcta.';
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(code) || /timeout/i.test(err.message)) {
    return 'La base de datos no responde. Puede estar suspendida, vencida o reiniciándose.';
  }
  if (code === '28P01') return 'El usuario o la contraseña de la base de datos no son correctos (revisa DATABASE_URL).';
  if (code === '3D000') return 'La base de datos indicada en DATABASE_URL no existe.';
  if (code === '57P03') return 'La base de datos se está iniciando. Intenta de nuevo en un momento.';
  return `No se pudo preparar la base de datos (${code || err.message}).`;
}

const page = (reason, attempts) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="15">
<title>CRM no disponible · Futurocol</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Segoe UI",Roboto,Arial,sans-serif;
background:linear-gradient(160deg,#4527A0,#1AA6E8);color:#fff;text-align:center;padding:24px;box-sizing:border-box}
.c{max-width:520px}img{width:96px;height:96px;border-radius:50%;background:#fff;padding:4px}
p.r{background:rgba(255,255,255,.15);border-radius:12px;padding:12px 16px}small{opacity:.8}</style></head>
<body><div class="c"><img src="/img/logo.png" alt=""><h1>El CRM no está disponible en este momento</h1>
<p class="r">${reason}</p><p>Se reintenta automáticamente. Esta página se recarga sola.</p>
<small>Intentos de conexión: ${attempts}. Si persiste, el administrador debe revisar la base de datos en Render.</small></div></body></html>`;

async function connectDatabase() {
  for (;;) {
    status.attempts += 1;
    try {
      await migrate();
      await ensureInitialAdmin();
      await realtime.start();
      automations.schedule(config.automationIntervalMinutes);
      status.ready = true;
      console.log('[inicio] Base de datos lista.');
      return;
    } catch (err) {
      status.reason = explain(err);
      console.error(`[inicio] Intento ${status.attempts}: ${status.reason} (${err.code || ''} ${err.message})`);
      await new Promise((r) => setTimeout(r, Math.min(30000, 5000 * status.attempts)));
    }
  }
}

function main() {
  const crm = createApp();
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (req, res) => res.status(status.ready ? 200 : 503).json({ ok: status.ready, reason: status.ready ? undefined : status.reason }));
  app.use((req, res, next) => {
    if (status.ready || req.path.startsWith('/img/')) return next();
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: status.reason });
    return res.status(503).set('Cache-Control', 'no-store').type('html').send(page(status.reason, status.attempts));
  });
  app.use(crm);

  const server = app.listen(config.port, () => {
    console.log(`Futurocol Academy CRM escuchando en http://localhost:${config.port}`);
  });
  connectDatabase();

  const shutdown = async () => {
    automations.unschedule();
    server.close();
    await realtime.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
