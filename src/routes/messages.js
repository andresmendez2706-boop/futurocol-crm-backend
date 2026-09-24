'use strict';

const express = require('express');
const db = require('../db');
const realtime = require('../realtime');
const repo = require('../services/repo');
const {
  ah, HttpError, newId, mapMessage,
} = require('../util');
const { z, parse, reqText } = require('../validate');

const router = express.Router();

router.get('/', ah(async (req, res) => res.json(await repo.listMessages(req.user))));

router.post('/', ah(async (req, res) => {
  const data = parse(z.object({ to: reqText(100), text: reqText(10000) }), req.body);
  if (data.to === req.user.id) throw new HttpError(400, 'No puedes enviarte mensajes a ti mismo');
  const { rows: to } = await db.query('SELECT id, email, name FROM users WHERE id = $1', [data.to]);
  if (!to[0]) throw new HttpError(400, 'El destinatario no existe');
  const { rows } = await db.query(
    'INSERT INTO messages (id, from_user, to_user, text) VALUES ($1, $2, $3, $4) RETURNING *',
    [newId('m'), req.user.id, data.to, data.text],
  );
  realtime.notifyChange('messages', [req.user.id, data.to]);
  res.status(201).json(mapMessage(rows[0]));
}));

module.exports = router;
