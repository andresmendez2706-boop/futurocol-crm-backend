'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { requireAuth } = require('./auth');
const { HttpError } = require('./util');

function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));

  const api = express.Router();
  api.use(requireAuth);
  api.use('/', require('./routes/core'));
  api.use('/users', require('./routes/users'));
  api.use('/companies', require('./routes/companies'));
  api.use('/contacts', require('./routes/contacts'));
  api.use('/deals', require('./routes/deals'));
  api.use('/tasks', require('./routes/tasks'));
  api.use('/messages', require('./routes/messages'));
  api.use('/settings', require('./routes/settings'));
  api.use('/admin', require('./routes/admin'));
  app.use('/api', api);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // Interfaz (SPA)
  const publicDir = path.join(__dirname, '..', 'public');
  // Sin caché larga: el navegador revalida (ETag) y cada actualización se ve al recargar.
  app.use(express.static(publicDir, {
    index: 'index.html',
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // Manejo de errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let body = { error: err.message };
    if (err instanceof HttpError) {
      const { status: _s, message: _m, stack: _st, issues: _i, ...rest } = err;
      body = { error: err.message, ...rest };
    } else if (err.type === 'entity.too.large') {
      body = { error: 'El archivo es demasiado grande' };
    } else if (err.type === 'entity.parse.failed') {
      status = 400; body = { error: 'JSON inválido' };
    } else if (err.code === '23505') {
      status = 409; body = { error: 'Ya existe un registro con esos datos' };
    } else if (err.code === '23514') {
      status = 422;
      body = err.constraint === 'deals_loss_reason_required'
        ? { error: 'Debes indicar el motivo de pérdida', code: 'LOSS_REASON_REQUIRED' }
        : { error: 'Datos inválidos' };
    } else if (err.code === '23503') {
      status = 409; body = { error: 'El registro está relacionado con otros datos' };
    } else if (status >= 500) {
      console.error(err);
      body = { error: 'Error interno del servidor' };
    }
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
