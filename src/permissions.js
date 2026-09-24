'use strict';

const { HttpError } = require('./util');

const isAdmin = (user) => user?.role === 'admin';

// Regla central de autorización del CRM:
//   canManage(record) = isAdmin() || record.assignedTo === currentUser.id
function canManage(user, record) {
  if (!user || !record) return false;
  const owner = record.assignedTo ?? record.assigned_to;
  return isAdmin(user) || owner === user.id;
}

function assertCanManage(user, record, what = 'este registro') {
  if (!canManage(user, record)) throw new HttpError(403, `No tienes permiso sobre ${what}`);
}

// Filtro SQL de alcance: el admin ve todo, el asesor solo lo asignado a él.
function scopeWhere(user, column = 'assigned_to', paramIndex = 1) {
  if (isAdmin(user)) return { sql: 'TRUE', params: [] };
  return { sql: `${column} = $${paramIndex}`, params: [user.id] };
}

module.exports = { isAdmin, canManage, assertCanManage, scopeWhere };
