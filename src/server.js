'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { migrate } = require('./migrate');
const realtime = require('./realtime');
const automations = require('./services/automations');
const { ensureInitialAdmin } = require('./cli/bootstrap-admin');
const { pool } = require('./db');

async function main() {
  await migrate();
  await ensureInitialAdmin();
  await realtime.start();
  automations.schedule(config.automationIntervalMinutes);
  const server = createApp().listen(config.port, () => {
    console.log(`Futurocol Academy CRM escuchando en http://localhost:${config.port}`);
  });
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
