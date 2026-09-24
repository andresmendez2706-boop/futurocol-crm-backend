'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { assertCanManage } = require('../permissions');
const { audit } = require('../audit');
const realtime = require('../realtime');
const repo = require('../services/repo');
const settings = require('../services/settings');
const { planStageChange } = require('../services/stageChange');
const { resolveAssignee, userName } = require('../services/ownership');
const { PROGRAMS, DEAL_TYPES } = require('../constants');
const { toCSV } = require('../csv');
const {
  ah, HttpError, newId, mapDeal, buildSet,
} = require('../util');
const {
  z, parse, reqText, optText, optDate, optNumber,
} = require('../validate');

const router = express.Router();

const nullableEnum = (values) => z.preprocess((v) => (v === '' ? null : v), z.enum(values).nullable().optional());
const base = {
  contactId: optText(100),
  value: optNumber(0, 1e15),
  dealType: nullableEnum(DEAL_TYPES),
  product: nullableEnum(PROGRAMS),
  convocatoria: optText(200),
  probability: z.preprocess((v) => (v === '' ? null : v === undefined || v === null ? v : Number(v)),
    z.number().int().min(0).max(100).nullable().optional()),
  expectedCloseDate: optDate,
  competitor: optText(200),
  nextStep: optText(1000),
  lossReason: optText(1000),
  assignedTo: optText(100),
};
const createSchema = z.object({ title: reqText(300), stage: z.string().optional(), ...base });
const updateSchema = z.object({ title: reqText(300).optional(), stage: z.string().optional(), ...base });

async function assertContact(user, contactId) {
  if (!contactId) return;
  const c = await repo.getRow('contacts', contactId);
  if (!c) throw new HttpError(400, 'El contacto indicado no existe');
  assertCanManage(user, c, 'ese contacto');
}

router.get('/', ah(async (req, res) => res.json(await repo.listDeals(req.user))));

router.post('/', ah(async (req, res) => {
  const data = parse(createSchema, req.body);
  await assertContact(req.user, data.contactId);
  const stages = await settings.getStages();
  const stage = data.stage || stages[0].id;
  const plan = planStageChange({ current: null, nextStage: stage, lossReason: data.lossReason, stages, user: req.user });
  const assignedTo = await resolveAssignee(req.user, data.assignedTo);
  const { rows } = await db.query(
    `INSERT INTO deals (id, title, contact_id, value, stage, deal_type, product, convocatoria, probability,
       expected_close_date, close_date, competitor, next_step, loss_reason, assigned_to, stage_history)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [newId('d'), data.title, data.contactId ?? null, data.value ?? 0, stage, data.dealType ?? null, data.product ?? null,
      data.convocatoria ?? null, data.probability ?? null, data.expectedCloseDate ?? null, plan.columns.close_date ?? null,
      data.competitor ?? null, data.nextStep ?? null, plan.columns.loss_reason ?? data.lossReason ?? null, assignedTo,
      JSON.stringify([plan.entry])],
  );
  await audit({ by: req.user, action: 'creación', entityType: 'negocio', entityLabel: data.title, detail: plan.detail });
  realtime.notifyChange('deals');
  res.status(201).json(mapDeal(rows[0]));
}));

// Edición general (y cambio de etapa si viene "stage"). Todo en una transacción con bloqueo de fila
// para que dos usuarios moviendo el mismo negocio no pierdan entradas del historial.
router.patch('/:id', ah(async (req, res) => {
  const data = parse(updateSchema, req.body);
  const stages = await settings.getStages();
  const deal = await db.tx(async (client) => {
    const { rows: cur } = await client.query('SELECT * FROM deals WHERE id = $1 FOR UPDATE', [req.params.id]);
    const current = cur[0];
    if (!current) throw new HttpError(404, 'Negocio no encontrado');
    assertCanManage(req.user, current, 'este negocio');
    if (data.contactId && data.contactId !== current.contact_id) await assertContact(req.user, data.contactId);

    const cols = {
      title: data.title, contact_id: data.contactId, value: data.value === null ? 0 : data.value,
      deal_type: data.dealType, product: data.product, convocatoria: data.convocatoria, probability: data.probability,
      expected_close_date: data.expectedCloseDate, competitor: data.competitor, next_step: data.nextStep,
      loss_reason: data.lossReason,
    };
    // No se puede quitar el motivo a un negocio perdido.
    if (current.stage === 'perdido' && data.lossReason === null && data.stage === undefined) {
      throw new HttpError(422, 'Un negocio perdido debe conservar su motivo de pérdida', { code: 'LOSS_REASON_REQUIRED' });
    }
    let plan = null;
    if (data.stage !== undefined && data.stage !== current.stage) {
      plan = planStageChange({ current, nextStage: data.stage, lossReason: data.lossReason, stages, user: req.user });
      Object.assign(cols, plan.columns);
    }
    let reassigned = null;
    if (data.assignedTo && data.assignedTo !== current.assigned_to) {
      reassigned = await resolveAssignee(req.user, data.assignedTo, client);
      cols.assigned_to = reassigned;
    }
    const set = buildSet(cols);
    let sql = set.sql;
    const values = [...set.values];
    if (plan) {
      values.push(JSON.stringify([plan.entry]));
      sql += `${sql ? ', ' : ''}stage_history = stage_history || $${values.length}::jsonb`;
    }
    if (!sql) return current;
    values.push(current.id);
    const { rows } = await client.query(
      `UPDATE deals SET ${sql}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values,
    );
    const label = rows[0].title;
    if (plan) await audit({ client, by: req.user, action: plan.action, entityType: 'negocio', entityLabel: label, detail: plan.detail });
    if (reassigned) {
      await audit({ client, by: req.user, action: 'cambio de responsable', entityType: 'negocio', entityLabel: label, detail: `→ ${await userName(reassigned, client)}` });
    }
    const edited = Object.entries(cols).filter(([k, v]) => v !== undefined && !['stage', 'close_date', 'assigned_to'].includes(k));
    if (edited.length && !(plan && edited.length === 1 && edited[0][0] === 'loss_reason')) {
      await audit({ client, by: req.user, action: 'edición', entityType: 'negocio', entityLabel: label });
    }
    return rows[0];
  });
  realtime.notifyChange('deals');
  res.json(mapDeal(deal));
}));

router.delete('/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await db.query('DELETE FROM deals WHERE id = $1 RETURNING title', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Negocio no encontrado');
  await audit({ by: req.user, action: 'eliminación', entityType: 'negocio', entityLabel: rows[0].title });
  realtime.notifyChange('deals');
  res.json({ ok: true });
}));

router.get('/export.csv', requireAdmin, ah(async (req, res) => {
  const stages = await settings.getStages();
  const { rows } = await db.query(
    `SELECT d.*, c.name AS contact_name, u.email AS owner_email FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.assigned_to ORDER BY d.created_at`,
  );
  const data = rows.map((r) => ({
    ...mapDeal(r), contactName: r.contact_name, ownerEmail: r.owner_email,
    stageLabel: stages.find((s) => s.id === r.stage)?.label || r.stage,
  }));
  const cols = [
    ['id', 'id'], ['title', 'titulo'], ['contactName', 'contacto'], ['value', 'valor'], ['stageLabel', 'etapa'],
    ['dealType', 'tipo'], ['product', 'programa'], ['convocatoria', 'convocatoria'], ['probability', 'probabilidad'],
    ['expectedCloseDate', 'cierre_esperado'], ['closeDate', 'fecha_cierre'], ['competitor', 'competidor'],
    ['nextStep', 'siguiente_paso'], ['lossReason', 'motivo_perdida'], ['ownerEmail', 'responsable'], ['createdAt', 'creado'],
  ].map(([key, label]) => ({ key, label }));
  await audit({ by: req.user, action: 'backup', entityType: 'negocio', detail: `Exportación CSV de ${data.length} negocios` });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="negocios.csv"');
  res.send(toCSV(data, cols));
}));

module.exports = router;
