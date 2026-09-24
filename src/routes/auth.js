'use strict';

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const {
  verifyPassword, hashPassword, signToken, setSessionCookie, clearSessionCookie, requireAuth,
} = require('../auth');
const { audit } = require('../audit');
const { ah, HttpError, mapUser } = require('../util');
const { z, parse } = require('../validate');

const router = express.Router();

// Límite de intentos FALLIDOS por IP + cuenta (un equipo detrás de la misma IP no se bloquea entre sí).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.login || '').trim().toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' },
});

// Hash ficticio para igualar tiempos cuando el usuario no existe.
const DUMMY_HASH = require('bcryptjs').hashSync('dummy-password', config.bcryptRounds);

router.post('/login', loginLimiter, ah(async (req, res) => {
  const { login, password } = parse(z.object({
    login: z.string().trim().min(1, 'ingresa tu correo'),
    password: z.string().min(1, 'ingresa tu contraseña'),
  }), req.body);
  // Se inicia sesión con el correo (también se acepta el nombre de usuario).
  const { rows } = await db.query(
    'SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1',
    [login],
  );
  const user = rows[0];
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Correo o contraseña incorrectos');
  setSessionCookie(res, signToken(user));
  await audit({ by: { id: user.id, name: user.name }, action: 'inicio de sesión', entityType: 'usuario', entityLabel: user.name });
  res.json({ user: mapUser(user, { full: true }) });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/password', requireAuth, ah(async (req, res) => {
  const { current, next } = parse(z.object({
    current: z.string().min(1),
    next: z.string().min(8, 'la nueva contraseña debe tener al menos 8 caracteres').max(200),
  }), req.body);
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(current, rows[0].password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta');
  const upd = await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING *',
    [await hashPassword(next), req.user.id],
  );
  setSessionCookie(res, signToken(upd.rows[0]));
  await audit({ by: req.user, action: 'edición', entityType: 'usuario', entityLabel: req.user.name, detail: 'Cambio de contraseña' });
  res.json({ ok: true });
}));

module.exports = router;
