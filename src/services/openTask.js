'use strict';

// Regla: un contacto o un negocio solo puede tener UNA tarea pendiente a la vez.
// Para programar la siguiente hay que completar (o eliminar) la que está abierta.

const { HttpError } = require('../util');

// Bloquea (dentro de la transacción) el contacto y el negocio para que dos peticiones
// simultáneas no puedan crear dos tareas abiertas a la vez.
async function lockTargets(client, { contactId, dealId }) {
  for (const key of [contactId && `c:${contactId}`, dealId && `d:${dealId}`].filter(Boolean).sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`open-task:${key}`]);
  }
}

async function findOpenTask(client, { contactId, dealId, excludeId = null }) {
  if (!contactId && !dealId) return null;
  const { rows } = await client.query(
    `SELECT t.id, t.title, t.due_date, t.contact_id, t.deal_id, u.name AS owner_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.done = false AND t.id IS DISTINCT FROM $3
        AND (($1::text IS NOT NULL AND t.contact_id = $1) OR ($2::text IS NOT NULL AND t.deal_id = $2))
      ORDER BY t.due_date NULLS LAST, t.created_at LIMIT 1`,
    [contactId || null, dealId || null, excludeId],
  );
  return rows[0] || null;
}

async function assertNoOpenTask(client, target) {
  const open = await findOpenTask(client, target);
  if (!open) return;
  const where = target.dealId && open.deal_id === target.dealId ? 'Este negocio' : 'Este contacto';
  const due = open.due_date ? ` (vence ${open.due_date.split('-').reverse().join('/')})` : '';
  throw new HttpError(409, `${where} ya tiene una tarea pendiente: "${open.title}"${due}, de ${open.owner_name || 'otro usuario'}. `
    + 'Márcala como completada antes de programar la siguiente.', {
    code: 'OPEN_TASK_EXISTS',
    openTask: { id: open.id, title: open.title, dueDate: open.due_date },
  });
}

module.exports = { lockTargets, findOpenTask, assertNoOpenTask };
