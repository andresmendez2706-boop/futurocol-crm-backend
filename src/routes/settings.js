'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { audit } = require('../audit');
const realtime = require('../realtime');
const settings = require('../services/settings');
const {
  PROTECTED_STAGES, WON, LOST, CURRENCIES,
} = require('../constants');
const { ah, HttpError, newId, buildSet } = require('../util');
const { mapAlly, getAlly } = require('../services/allies');
const { z, parse } = require('../validate');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  res.json({ stages: await settings.getStages(), commissions: await settings.getCommissions(), currency: await settings.getCurrency() });
}));

// Aliados (universidades). El admin los crea y edita; no se eliminan (se desactivan) para no
// perder la historia de sus negocios.
const allySchema = z.object({
  name: z.string().trim().min(1, 'nombre obligatorio').max(80),
  commissionRate: z.coerce.number().min(0).max(100),
  programs: z.array(z.string().trim().min(1).max(200)).max(300).default([]),
  active: z.boolean().default(true),
});
const cleanPrograms = (list) => [...new Set(list.map((p) => p.trim()).filter(Boolean))];

router.post('/allies', requireAdmin, ah(async (req, res) => {
  const d = parse(allySchema, req.body);
  const { rows } = await db.query(
    'INSERT INTO allies (id, name, commission_rate, programs, active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [newId('ally'), d.name, d.commissionRate, JSON.stringify(cleanPrograms(d.programs)), d.active],
  );
  await audit({ by: req.user, action: 'creación', entityType: 'aliado', entityLabel: d.name, detail: `Paga ${d.commissionRate}% · ${d.programs.length} programa(s)` });
  realtime.notifyChange('all');
  res.status(201).json(mapAlly(rows[0]));
}));

router.patch('/allies/:id', requireAdmin, ah(async (req, res) => {
  const d = parse(allySchema.partial(), req.body);
  const old = await getAlly(req.params.id);
  if (!old) throw new HttpError(404, 'Aliado no encontrado');
  const set = buildSet({
    name: d.name, commission_rate: d.commissionRate, active: d.active,
    programs: d.programs === undefined ? undefined : JSON.stringify(cleanPrograms(d.programs)),
  });
  if (!set.count) return res.json(old);
  const { rows } = await db.query(`UPDATE allies SET ${set.sql} WHERE id = $${set.count + 1} RETURNING *`, [...set.values, old.id]);
  const changes = [];
  if (d.commissionRate !== undefined && Number(d.commissionRate) !== old.commissionRate) changes.push(`% ${old.commissionRate} → ${d.commissionRate}`);
  if (d.name && d.name !== old.name) changes.push(`nombre ${old.name} → ${d.name}`);
  if (d.programs) changes.push(`${cleanPrograms(d.programs).length} programa(s)`);
  if (d.active !== undefined && d.active !== old.active) changes.push(d.active ? 'activado' : 'desactivado');
  await audit({
    by: req.user, action: d.commissionRate !== undefined && Number(d.commissionRate) !== old.commissionRate ? 'cambio de comisión' : 'configuración',
    entityType: 'aliado', entityLabel: rows[0].name, detail: changes.join(' · ') || null,
  });
  realtime.notifyChange('all');
  res.json(mapAlly(rows[0]));
}));

// Moneda en la que se muestran todos los valores (solo cambia cómo se ven; no convierte montos).
router.put('/currency', requireAdmin, ah(async (req, res) => {
  const { currency } = parse(z.object({ currency: z.enum(CURRENCIES) }), req.body);
  const old = await settings.getCurrency();
  await settings.set('currency', currency);
  if (old !== currency) {
    await audit({ by: req.user, action: 'configuración', entityType: 'moneda', entityLabel: 'Moneda', detail: `${old} → ${currency}` });
  }
  realtime.notifyChange('all');
  res.json({ currency });
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
