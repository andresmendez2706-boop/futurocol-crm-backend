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
const { ah, HttpError, mapAudit } = require('../util');
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
  const { year } = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100) }), req.query);
  res.json(await metrics.finance(req.user, year));
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
