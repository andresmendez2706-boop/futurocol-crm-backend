'use strict';

const db = require('../db');
const { isAdmin } = require('../permissions');
const { HttpError } = require('../util');

// Determina el responsable de un registro nuevo: el asesor siempre queda como responsable;
// el admin puede elegir cualquier usuario existente.
async function resolveAssignee(user, requested, client = db) {
  if (!requested || requested === user.id) return user.id;
  if (!isAdmin(user)) throw new HttpError(403, 'Solo el administrador puede asignar registros a otro usuario');
  const { rows } = await client.query('SELECT id FROM users WHERE id = $1', [requested]);
  if (!rows[0]) throw new HttpError(400, 'El responsable indicado no existe');
  return requested;
}

async function userName(id, client = db) {
  const { rows } = await client.query('SELECT name FROM users WHERE id = $1', [id]);
  return rows[0]?.name || id;
}

module.exports = { resolveAssignee, userName };
