'use strict';

// Aliados (universidades): cada uno paga a Futurocol su propio % y tiene su lista de programas.

const db = require('../db');
const { HttpError } = require('../util');

const mapAlly = (r) => ({
  id: r.id, name: r.name, commissionRate: Number(r.commission_rate), programs: r.programs || [], active: r.active,
});

async function listAllies(client = db) {
  const { rows } = await client.query('SELECT * FROM allies ORDER BY created_at, name');
  return rows.map(mapAlly);
}

async function getAlly(id, client = db) {
  if (!id) return null;
  const { rows } = await client.query('SELECT * FROM allies WHERE id = $1', [id]);
  return rows[0] ? mapAlly(rows[0]) : null;
}

// Aliados que puede vender un usuario: el admin, todos; el asesor, los asignados ([] = todos).
const allowedAllyIds = (user, allies) => {
  const ids = Array.isArray(user.allyIds) ? user.allyIds : [];
  return user.role === 'admin' || !ids.length ? allies.map((a) => a.id) : ids;
};

/**
 * Determina y valida el aliado de un contacto/negocio nuevo o editado.
 * Si no se indica, usa el único aliado del asesor o el primero activo.
 */
async function resolveAlly(user, requestedId, client = db) {
  const allies = await listAllies(client);
  const allowed = allowedAllyIds(user, allies);
  let id = requestedId;
  if (!id) id = allowed.find((a) => allies.find((x) => x.id === a && x.active)) || allies.find((a) => a.active)?.id;
  const ally = allies.find((a) => a.id === id);
  if (!ally) throw new HttpError(400, 'El aliado indicado no existe');
  if (!allowed.includes(ally.id)) throw new HttpError(403, `No tienes asignado el aliado ${ally.name}`);
  return ally;
}

// El programa debe pertenecer al aliado (si el aliado tiene lista de programas).
function assertProgram(ally, program, field = 'programa') {
  if (!program || !ally.programs.length) return;
  if (!ally.programs.includes(program)) throw new HttpError(400, `El ${field} "${program}" no pertenece a ${ally.name}`);
}

module.exports = { mapAlly, listAllies, getAlly, allowedAllyIds, resolveAlly, assertProgram };
