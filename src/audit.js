'use strict';

const db = require('./db');
const { newId } = require('./util');

// Registra una entrada de auditoría. `by` puede ser el usuario de la petición o un texto
// (p. ej. "Sistema" para automatizaciones). `client` permite usarlo dentro de una transacción.
async function audit({ by, action, entityType = null, entityLabel = null, detail = null, client = db }) {
  const byName = typeof by === 'string' ? by : by?.name || 'Sistema';
  const byId = typeof by === 'object' && by ? by.id : null;
  await client.query(
    `INSERT INTO audit_log (id, by_name, by_user_id, action, entity_type, entity_label, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [newId('log'), byName, byId, action, entityType, entityLabel, detail],
  );
}

module.exports = { audit };
