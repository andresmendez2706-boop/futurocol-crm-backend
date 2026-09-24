'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./util');

const COOKIE = 'crm_token';

const hashPassword = (plain) => bcrypt.hash(String(plain), config.bcryptRounds);
const verifyPassword = (plain, hash) => bcrypt.compare(String(plain), hash);

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

async function loadUserFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const u = rows[0];
  // token_version invalida sesiones tras cambio de contraseña o de rol.
  if (!u || u.token_version !== payload.tv) return null;
  return u;
}

// Autenticación obligatoria. Se re-lee el usuario en cada petición, así un cambio de rol o
// una eliminación tiene efecto inmediato.
async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer || req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'No autenticado');
    const u = await loadUserFromToken(token);
    if (!u) {
      clearSessionCookie(res);
      throw new HttpError(401, 'Sesión expirada o inválida');
    }
    // Protección CSRF: las peticiones que modifican datos con cookie deben traer una cabecera
    // personalizada (un formulario de otro sitio no puede enviarla).
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'XMLHttpRequest') {
      throw new HttpError(403, 'Falta cabecera X-Requested-With');
    }
    req.user = {
      id: u.id, name: u.name, username: u.username, email: u.email, role: u.role,
      commissionRate: u.commission_rate, prefs: u.prefs || {},
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Solo el administrador puede realizar esta acción'));
  next();
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie,
  requireAuth, requireAdmin, loadUserFromToken,
};
