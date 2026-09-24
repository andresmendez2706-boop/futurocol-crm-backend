'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { audit } = require('../audit');
const realtime = require('../realtime');
const settings = require('../services/settings');
const { PROTECTED_STAGES, WON, LOST } = require('../constants');
const { ah, HttpError } = require('../util');
const { z, parse } = require('../validate');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  res.json({ stages: await settings.getStages(), commissions: await settings.getCommissions() });
}));

// Etapas: agregar / renombrar / reordenar / eliminar sin tocar código.
// Las protegidas (aplazado, ganado, perdido) solo se pueden renombrar.
router.put('/stages', requireAdmin, ah(async (req, res) => {
  const body = parse(z.object({
    stages: z.array(z.object({
      id: z.string().trim().max(60).optional().nullable(),
      label: z.string().trim().min(1, 'nombre obligatorio').max(80),
      probability: z.coerce.number().min(0).max(100).optional(),
    })).min(1),
    moveDeals: z.record(z.string()).optional(),
  }), req.body);

  const result = await db.tx(async (client) => {
    const old = await settings.getStages(client);
    const used = new Set(old.map((s) => s.id));
    const incoming = body.stages.map((s) => {
      if (s.id && (used.has(s.id) || PROTECTED_STAGES.includes(s.id))) return s;
      let id = settings.slug(s.label);
      while (used.has(id) || PROTECTED_STAGES.includes(id)) id = `${id}_${Math.random().toString(36).slice(2, 5)}`;
      used.add(id);
      return { ...s, id };
    });
    settings.validateStagesInput(incoming);
    const next = settings.normalizeStages(incoming);
    const nextIds = new Set(next.map((s) => s.id));
    const removed = old.filter((s) => !nextIds.has(s.id));
    const moveDeals = body.moveDeals || {};
    let moved = 0;

    for (const st of removed) {
      const { rows } = await client.query('SELECT id FROM deals WHERE stage = $1', [st.id]);
      if (!rows.length) continue;
      const target = moveDeals[st.id];
      if (!target || !nextIds.has(target) || target === WON || target === LOST) {
        throw new HttpError(409, `La etapa "${st.label}" tiene ${rows.length} negocio(s). Elige a qué etapa moverlos (no puede ser ganado ni perdido).`, {
          code: 'STAGE_IN_USE', stage: st.id, count: rows.length,
        });
      }
      const entry = { stage: target, from: st.id, at: new Date().toISOString(), by: req.user.name };
      const r = await client.query(
        'UPDATE deals SET stage = $1, stage_history = stage_history || $2::jsonb, updated_at = now() WHERE stage = $3',
        [target, JSON.stringify([entry]), st.id],
      );
      moved += r.rowCount;
    }
    await settings.set('stages', next, client);
    const describe = (list) => list.map((s) => s.label).join(' → ');
    await audit({
      client, by: req.user, action: 'configuración', entityType: 'etapas', entityLabel: 'Etapas del pipeline',
      detail: `${describe(old)}  ⇒  ${describe(next)}${removed.length ? ` · eliminadas: ${removed.map((s) => s.label).join(', ')}` : ''}${moved ? ` · ${moved} negocio(s) movidos` : ''}`,
    });
    return { stages: next, moved };
  });
  realtime.notifyChange('all');
  res.json(result);
}));

router.put('/commissions', requireAdmin, ah(async (req, res) => {
  const data = parse(z.object({
    adminDefault: z.coerce.number().min(0).max(100),
    asesorDefault: z.coerce.number().min(0).max(100),
    asesorScales: z.array(z.coerce.number().min(0).max(100)).max(20),
  }), req.body);
  const old = await settings.getCommissions();
  const value = { ...data, asesorScales: [...new Set(data.asesorScales)].sort((a, b) => a - b) };
  await settings.set('commissions', value);
  await audit({
    by: req.user, action: 'configuración', entityType: 'comisiones', entityLabel: 'Comisiones',
    detail: `Admin ${old.adminDefault}% → ${value.adminDefault}% · Asesor por defecto ${old.asesorDefault}% → ${value.asesorDefault}% · Escalas: ${value.asesorScales.join('/')}%`,
  });
  realtime.notifyChange('all');
  res.json(value);
}));

module.exports = router;
