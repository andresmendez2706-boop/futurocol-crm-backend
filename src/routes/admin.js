'use strict';

// Rutas exclusivas del administrador: auditoría, copias de seguridad, reportes, código fuente
// y ejecución manual de automatizaciones.

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { audit } = require('../audit');
const realtime = require('../realtime');
const metrics = require('../services/metrics');
const backup = require('../services/backup');
const { runAutomations } = require('../services/automations');
const { parsePeriod } = require('../services/rules');
const {
  ah, HttpError, mapAudit, mapExpense, newId, buildSet,
} = require('../util');
const { z, parse } = require('../validate');

const router = express.Router();
router.use(requireAdmin);

// Auditoría: solo lectura (no existe ninguna ruta para editarla o borrarla).
router.get('/audit', ah(async (req, res) => {
  const q = parse(z.object({
    entityType: z.string().max(50).optional(),
    action: z.string().max(50).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(500),
    before: z.string().datetime().optional(),
  }), req.query);
  const where = [];
  const params = [];
  if (q.entityType) { params.push(q.entityType); where.push(`entity_type = $${params.length}`); }
  if (q.action) { params.push(q.action); where.push(`action = $${params.length}`); }
  if (q.before) { params.push(q.before); where.push(`at < $${params.length}`); }
  params.push(q.limit);
  const { rows } = await db.query(
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT $${params.length}`,
    params,
  );
  const types = await db.query('SELECT DISTINCT entity_type FROM audit_log WHERE entity_type IS NOT NULL ORDER BY 1');
  res.json({ entries: rows.map(mapAudit), entityTypes: types.rows.map((r) => r.entity_type) });
}));

router.get('/backup', ah(async (req, res) => {
  const data = await backup.exportBackup();
  await audit({ by: req.user, action: 'backup', entityType: 'backup', entityLabel: 'Copia de seguridad completa' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="futurocol-crm-backup-${stamp}.json"`);
  res.json(data);
}));

router.post('/backup/import', ah(async (req, res) => {
  const { data, mode } = parse(z.object({
    data: z.any().refine((v) => v && typeof v === 'object', 'el archivo no es un JSON válido'),
    mode: z.enum(['merge', 'replace']).default('merge'),
  }), req.body);
  const result = await backup.importBackup(data, { mode, actor: req.user });
  realtime.notifyChange('all');
  res.json(result);
}));

router.get('/reports', ah(async (req, res) => {
  res.json(await metrics.reports(parsePeriod(req.query)));
}));

router.get('/finance', ah(async (req, res) => {
  const q = parse(z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    all: z.enum(['1', 'true']).optional(),
  }), req.query);
  if (!q.all && !q.year) throw new HttpError(400, 'Indica year o all=1');
  res.json(await metrics.finance(req.user, { year: q.year, all: !!q.all }));
}));

// ---- Gastos de operación (solo admin, ingreso manual)
const expenseSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  category: z.string().trim().min(1, 'elige una categoría').max(60),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.coerce.number().min(0, 'el valor no puede ser negativo').max(1e13),
});
const fmtMoney = (n) => `$${Number(n).toLocaleString('es-CO')}`;

router.post('/expenses', ah(async (req, res) => {
  const d = parse(expenseSchema, req.body);
  const { rows } = await db.query(
    `INSERT INTO expenses (id, year, month, category, description, amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [newId('g'), d.year, d.month, d.category, d.description || null, d.amount, req.user.id],
  );
  await audit({ by: req.user, action: 'creación', entityType: 'gasto', entityLabel: `${d.category} ${d.month}/${d.year}`, detail: `${fmtMoney(d.amount)}${d.description ? ` · ${d.description}` : ''}` });
  realtime.notifyChange('finance', []);
  res.status(201).json(mapExpense(rows[0]));
}));

router.patch('/expenses/:id', ah(async (req, res) => {
  const d = parse(expenseSchema.partial(), req.body);
  const set = buildSet({ year: d.year, month: d.month, category: d.category, description: d.description, amount: d.amount });
  if (!set.count) throw new HttpError(400, 'Nada que actualizar');
  const { rows } = await db.query(
    `UPDATE expenses SET ${set.sql}, updated_at = now() WHERE id = $${set.count + 1} RETURNING *`, [...set.values, req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, 'Gasto no encontrado');
  const e = rows[0];
  await audit({ by: req.user, action: 'edición', entityType: 'gasto', entityLabel: `${e.category} ${e.month}/${e.year}`, detail: fmtMoney(e.amount) });
  realtime.notifyChange('finance', []);
  res.json(mapExpense(e));
}));

router.delete('/expenses/:id', ah(async (req, res) => {
  const { rows } = await db.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Gasto no encontrado');
  const e = rows[0];
  await audit({ by: req.user, action: 'eliminación', entityType: 'gasto', entityLabel: `${e.category} ${e.month}/${e.year}`, detail: fmtMoney(e.amount) });
  realtime.notifyChange('finance', []);
  res.json({ ok: true });
}));

// Copia los gastos de un mes a otro (útil para gastos fijos como los planes móviles).
router.post('/expenses/copy', ah(async (req, res) => {
  const p = parse(z.object({
    fromYear: z.coerce.number().int(), fromMonth: z.coerce.number().int().min(1).max(12),
    toYear: z.coerce.number().int().min(2000).max(2100), toMonth: z.coerce.number().int().min(1).max(12),
  }), req.body);
  const { rows } = await db.query('SELECT * FROM expenses WHERE year = $1 AND month = $2', [p.fromYear, p.fromMonth]);
  for (const e of rows) {
    await db.query(
      `INSERT INTO expenses (id, year, month, category, description, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId('g'), p.toYear, p.toMonth, e.category, e.description, e.amount, req.user.id],
    );
  }
  if (rows.length) {
    await audit({ by: req.user, action: 'creación', entityType: 'gasto', entityLabel: `${p.toMonth}/${p.toYear}`, detail: `${rows.length} gasto(s) copiados de ${p.fromMonth}/${p.fromYear}` });
    realtime.notifyChange('finance', []);
  }
  res.json({ copied: rows.length });
}));

router.post('/automations/run', ah(async (req, res) => {
  res.json(await runAutomations());
}));

// "Código fuente": el admin puede consultar los archivos de la interfaz.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
function listSourceFiles(dir = PUBLIC_DIR, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return listSourceFiles(path.join(dir, e.name), rel);
    return /\.(html|css|js|svg)$/.test(e.name) ? [rel] : [];
  }).sort();
}
router.get('/source', ah(async (req, res) => {
  const files = listSourceFiles();
  if (!req.query.file) return res.json({ files });
  const file = String(req.query.file);
  if (!files.includes(file)) throw new HttpError(404, 'Archivo no encontrado');
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8'));
}));

module.exports = router;
