'use strict';

const express = require('express');
const db = require('../db');
const { assertCanManage } = require('../permissions');
const { audit } = require('../audit');
const realtime = require('../realtime');
const repo = require('../services/repo');
const { resolveAssignee } = require('../services/ownership');
const { lockTargets, assertNoOpenTask } = require('../services/openTask');
const { TASK_TYPES } = require('../constants');
const {
  ah, HttpError, newId, mapTask, buildSet,
} = require('../util');
const {
  z, parse, reqText, optText, optDate, optTime,
} = require('../validate');

const router = express.Router();

const base = {
  contactId: optText(100), dealId: optText(100), type: z.enum(TASK_TYPES).optional(), dueDate: optDate,
  contactTime: optTime, scheduleTime: optTime, notes: optText(5000), done: z.boolean().optional(),
  assignedTo: optText(100),
};
const createSchema = z.object({ title: reqText(300), ...base });
const updateSchema = z.object({ title: reqText(300).optional(), ...base });

// Tareas: cada quien modifica solo las suyas. El admin ve todas, pero las ajenas en solo lectura.
function assertOwnTask(user, task) {
  if (task.assigned_to !== user.id) throw new HttpError(403, 'Solo el responsable de la tarea puede modificarla');
}

async function assertContact(user, contactId) {
  if (!contactId) return;
  const c = await repo.getRow('contacts', contactId);
  if (!c) throw new HttpError(400, 'El contacto indicado no existe');
  assertCanManage(user, c, 'ese contacto');
}

async function assertDeal(user, dealId) {
  if (!dealId) return;
  const d = await repo.getRow('deals', dealId);
  if (!d) throw new HttpError(400, 'El negocio indicado no existe');
  assertCanManage(user, d, 'ese negocio');
}

router.get('/', ah(async (req, res) => res.json(await repo.listTasks(req.user))));

router.post('/', ah(async (req, res) => {
  const data = parse(createSchema, req.body);
  await assertContact(req.user, data.contactId);
  await assertDeal(req.user, data.dealId);
  // Una tarea de un negocio queda también ligada a su contacto.
  if (data.dealId && !data.contactId) data.contactId = (await repo.getRow('deals', data.dealId))?.contact_id || null;
  const assignedTo = await resolveAssignee(req.user, data.assignedTo);
  const rows = await db.tx(async (client) => {
    const target = { contactId: data.contactId, dealId: data.dealId };
    await lockTargets(client, target);
    if (!data.done) await assertNoOpenTask(client, target);
    return (await client.query(
      `INSERT INTO tasks (id, contact_id, deal_id, title, type, due_date, contact_time, schedule_time, notes, done,
         completed_at, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [newId('t'), data.contactId ?? null, data.dealId ?? null, data.title, data.type || 'otro', data.dueDate ?? null,
        data.contactTime ?? null, data.scheduleTime ?? null, data.notes ?? null, !!data.done, data.done ? new Date() : null,
        assignedTo],
    )).rows;
  });
  await audit({ by: req.user, action: 'creación', entityType: 'tarea', entityLabel: data.title });
  realtime.notifyChange('tasks');
  res.status(201).json(mapTask(rows[0]));
}));

router.patch('/:id', ah(async (req, res) => {
  const data = parse(updateSchema, req.body);
  const current = await repo.getRow('tasks', req.params.id);
  if (!current) throw new HttpError(404, 'Tarea no encontrada');
  assertOwnTask(req.user, current);
  if (data.contactId && data.contactId !== current.contact_id) await assertContact(req.user, data.contactId);
  if (data.dealId && data.dealId !== current.deal_id) await assertDeal(req.user, data.dealId);
  const cols = {
    title: data.title, contact_id: data.contactId, deal_id: data.dealId, type: data.type, due_date: data.dueDate,
    contact_time: data.contactTime, schedule_time: data.scheduleTime, notes: data.notes,
  };
  if (data.done !== undefined && data.done !== current.done) {
    cols.done = data.done;
    cols.completed_at = data.done ? new Date() : null;
  }
  if (data.assignedTo && data.assignedTo !== current.assigned_to) {
    cols.assigned_to = await resolveAssignee(req.user, data.assignedTo);
  }
  const set = buildSet(cols);
  if (!set.count) return res.json(mapTask(current));
  const rows = await db.tx(async (client) => {
    // Si la tarea queda (o vuelve a quedar) pendiente, o cambia de contacto/negocio,
    // no puede haber otra tarea abierta en ese contacto o negocio.
    const willBeOpen = cols.done === undefined ? !current.done : !cols.done;
    const target = {
      contactId: cols.contact_id !== undefined ? cols.contact_id : current.contact_id,
      dealId: cols.deal_id !== undefined ? cols.deal_id : current.deal_id,
      excludeId: current.id,
    };
    const targetChanged = target.contactId !== current.contact_id || target.dealId !== current.deal_id;
    if (willBeOpen && (current.done || targetChanged)) {
      await lockTargets(client, target);
      await assertNoOpenTask(client, target);
    }
    return (await client.query(
      `UPDATE tasks SET ${set.sql}, updated_at = now() WHERE id = $${set.count + 1} RETURNING *`,
      [...set.values, current.id],
    )).rows;
  });
  realtime.notifyChange('tasks');
  res.json(mapTask(rows[0]));
}));

router.delete('/:id', ah(async (req, res) => {
  const current = await repo.getRow('tasks', req.params.id);
  if (!current) throw new HttpError(404, 'Tarea no encontrada');
  assertOwnTask(req.user, current);
  await db.query('DELETE FROM tasks WHERE id = $1', [current.id]);
  await audit({ by: req.user, action: 'eliminación', entityType: 'tarea', entityLabel: current.title });
  realtime.notifyChange('tasks');
  res.json({ ok: true });
}));

module.exports = router;
