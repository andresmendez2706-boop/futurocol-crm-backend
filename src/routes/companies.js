'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { assertCanManage } = require('../permissions');
const { audit } = require('../audit');
const realtime = require('../realtime');
const repo = require('../services/repo');
const { resolveAssignee, userName } = require('../services/ownership');
const {
  ah, HttpError, newId, mapCompany, buildSet,
} = require('../util');
const {
  z, parse, reqText, optText,
} = require('../validate');

const router = express.Router();

const fields = {
  nit: optText(50), domain: optText(200), phone: optText(50), email: optText(200), address: optText(300),
  city: optText(100), department: optText(100), country: optText(100), sector: optText(100),
  employees: optText(50), source: optText(100), notes: optText(5000), assignedTo: optText(100),
};
const createSchema = z.object({ name: reqText(200), ...fields });
const updateSchema = z.object({ name: reqText(200).optional(), ...fields });

const toColumns = (d) => ({
  name: d.name, nit: d.nit, domain: d.domain, phone: d.phone, email: d.email, address: d.address, city: d.city,
  department: d.department, country: d.country, sector: d.sector, employees: d.employees, source: d.source, notes: d.notes,
});

router.get('/', ah(async (req, res) => res.json(await repo.listCompanies(req.user))));

router.post('/', ah(async (req, res) => {
  const data = parse(createSchema, req.body);
  const assignedTo = await resolveAssignee(req.user, data.assignedTo);
  const cols = { id: newId('co'), ...toColumns(data), assigned_to: assignedTo };
  const keys = Object.keys(cols);
  const { rows } = await db.query(
    `INSERT INTO companies (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    keys.map((k) => cols[k] ?? null),
  );
  await audit({ by: req.user, action: 'creación', entityType: 'empresa', entityLabel: data.name });
  realtime.notifyChange('companies');
  res.status(201).json(mapCompany(rows[0]));
}));

router.patch('/:id', ah(async (req, res) => {
  const data = parse(updateSchema, req.body);
  const current = await repo.getRow('companies', req.params.id);
  if (!current) throw new HttpError(404, 'Empresa no encontrada');
  assertCanManage(req.user, current, 'esta empresa');
  const cols = toColumns(data);
  if (data.assignedTo !== undefined && data.assignedTo && data.assignedTo !== current.assigned_to) {
    cols.assigned_to = await resolveAssignee(req.user, data.assignedTo);
  }
  const set = buildSet(cols);
  if (!set.count) return res.json(mapCompany(current));
  const { rows } = await db.query(
    `UPDATE companies SET ${set.sql}, updated_at = now() WHERE id = $${set.count + 1} RETURNING *`,
    [...set.values, current.id],
  );
  const label = rows[0].name;
  if (cols.assigned_to) {
    await audit({ by: req.user, action: 'cambio de responsable', entityType: 'empresa', entityLabel: label, detail: `→ ${await userName(cols.assigned_to)}` });
  }
  await audit({ by: req.user, action: 'edición', entityType: 'empresa', entityLabel: label });
  realtime.notifyChange('companies');
  res.json(mapCompany(rows[0]));
}));

router.delete('/:id', requireAdmin, ah(async (req, res) => {
  const { rows } = await db.query('DELETE FROM companies WHERE id = $1 RETURNING name', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Empresa no encontrada');
  await audit({ by: req.user, action: 'eliminación', entityType: 'empresa', entityLabel: rows[0].name });
  realtime.notifyChange('companies');
  res.json({ ok: true });
}));

module.exports = router;
