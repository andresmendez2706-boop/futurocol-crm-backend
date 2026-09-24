'use strict';

// Carga opcional de .env sin dependencias externas.
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';

const config = {
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || 'postgres://crm:crm@localhost:5432/futurocol_crm_test'
    : process.env.DATABASE_URL || 'postgres://crm:crm@localhost:5432/futurocol_crm',
  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-secret' : ''),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || (isTest ? 4 : 12)),
  // Zona horaria de negocio: define qué es "hoy" (fecha de cierre, semáforo, automatizaciones).
  timeZone: process.env.APP_TIMEZONE || 'America/Bogota',
  automationIntervalMinutes: Number(process.env.AUTOMATION_INTERVAL_MINUTES || 15),
  trustProxy: process.env.TRUST_PROXY || false,
};

if (!config.jwtSecret) {
  if (config.isProduction) {
    throw new Error('JWT_SECRET es obligatorio en producción');
  }
  config.jwtSecret = 'dev-secret-cambiar';
  console.warn('[config] JWT_SECRET no definido: usando un secreto de desarrollo. NO usar en producción.');
}

module.exports = config;
