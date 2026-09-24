'use strict';

// Datos generales del usuario autenticado: carga inicial, preferencias, panel, embudo y eventos.

const express = require('express');
const db = require('../db');
const repo = require('../services/repo');
const settings = require('../services/settings');
const metrics = require('../services/metrics');
const realtime = require('../realtime');
const { parsePeriod } = require('../services/rules');
const constants = require('../constants');
const { ah, todayISO } = require('../util');
const { z, parse } = require('../validate');

const router = express.Router();

// Carga inicial: todo lo que el usuario puede ver, ya filtrado por sus permisos.
router.get('/bootstrap', ah(async (req, res) => {
  const [users, companies, contacts, deals, tasks, messages, stages, commissions] = await Promise.all([
    repo.listUsers(req.user), repo.listCompanies(req.user), repo.listContacts(req.user), repo.listDeals(req.user),
    repo.listTasks(req.user), repo.listMessages(req.user), settings.getStages(), settings.getCommissions(),
  ]);
  res.json({
    me: req.user,
    today: todayISO(),
    users, companies, contacts, deals, tasks, messages,
    settings: { stages, commissions },
    constants: {
      programs: constants.PROGRAMS, dealTypes: constants.DEAL_TYPES, taskTypes: constants.TASK_TYPES,
      activityTypes: constants.ACTIVITY_TYPES, closedStages: constants.CLOSED_STAGES,
      protectedStages: constants.PROTECTED_STAGES,
    },
  });
}));

// Preferencias por usuario (período seleccionado, vista del plan de trabajo, etc.).
router.patch('/me/prefs', ah(async (req, res) => {
  const prefs = parse(z.record(z.any()), req.body);
  if (JSON.stringify(prefs).length > 10000) return res.status(400).json({ error: 'Preferencias demasiado grandes' });
  const { rows } = await db.query('UPDATE users SET prefs = prefs || $1::jsonb WHERE id = $2 RETURNING prefs', [JSON.stringify(prefs), req.user.id]);
  res.json(rows[0].prefs);
}));

router.get('/stats/dashboard', ah(async (req, res) => {
  res.json(await metrics.dashboard(req.user, parsePeriod(req.query)));
}));

router.get('/stats/funnel', ah(async (req, res) => {
  res.json(await metrics.funnel(req.user, { userId: req.query.userId || null, period: parsePeriod(req.query) }));
}));

router.get('/events', realtime.sseHandler);

module.exports = router;
