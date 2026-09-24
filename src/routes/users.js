'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin, hashPassword } = require('../auth');
const { audit } = require('../audit');
const realtime = require('../realtime');
const {
  ah, HttpError, newId, mapUser, buildSet,
} = require('../util');
const {
  z, parse, reqText, email, optNumber,
} = require('../validate');

const router = express.Router();
router.use(requireAdmin);

const username = z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/, 'solo letras, números, punto, guion');
const role = z.enum(['admin', 'asesor']);

async function assertUnique({ email: mail, username: user }, exceptId = null) {
  const { rows } = await db.query(
    `SELECT id, lower(email) AS email, lower(username) AS username FROM users
     WHERE (lower(email) = lower($1) OR lower(username) = lower($2)) AND id IS DISTINCT FROM $3`,
    [mail || '', user || '', exceptId],
  );
  if (rows.some((r) => mail && r.email === mail.toLowerCase())) throw new HttpError(409, 'Ya existe un usuario con ese correo');
  if (rows.some((r) => user && r.username === user.toLowerCase())) throw new HttpError(409, 'Ya existe un usuario con ese nombre de usuario');
}

router.get('/', ah(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users ORDER BY name');
  res.json(rows.map((r) => mapUser(r, { full: true })));
}));

router.post('/', ah(async (req, res) => {
  const data = parse(z.object({
    name: reqText(120), username, email, role,
    password: z.string().min(8, 'mínimo 8 caracteres').max(200),
    commissionRate: optNumber(0, 100),
  }), req.body);
  await assertUnique(data);
  const { rows } = await db.query(
    `INSERT INTO users (id, name, username, email, password_hash, role, commission_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [newId('u'), data.name, data.username, data.email, await hashPassword(data.password), data.role, data.commissionRate ?? null],
  );
  await audit({ by: req.user, action: 'creación', entityType: 'usuario', entityLabel: data.name, detail: `Rol: ${data.role}` });
  realtime.notifyChange('users');
  res.status(201).json(mapUser(rows[0], { full: true }));
}));

router.patch('/:id', ah(async (req, res) => {
  const data = parse(z.object({
    name: reqText(120).optional(), username: username.optional(), email: email.optional(), role: role.optional(),
    password: z.string().min(8, 'mínimo 8 caracteres').max(200).optional(),
    commissionRate: optNumber(0, 100),
  }), req.body);
  const { rows: cur } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const user = cur[0];
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  await assertUnique(data, user.id);

  if (data.role && data.role !== user.role && user.role === 'admin') {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
    if (rows[0].n <= 1) throw new HttpError(400, 'Debe existir al menos un administrador');
  }

  const fields = {
    name: data.name, username: data.username, email: data.email, role: data.role,
    // Cambiar la tasa de un usuario solo afecta a ese usuario (columna individual).
    commission_rate: data.commissionRate,
  };
  if (data.password) fields.password_hash = await hashPassword(data.password);
  const set = buildSet(fields);
  if (set.count === 0) return res.json(mapUser(user, { full: true }));
  const extraSql = data.password ? ', token_version = token_version + 1' : '';
  const { rows } = await db.query(
    `UPDATE users SET ${set.sql}${extraSql} WHERE id = $${set.count + 1} RETURNING *`,
    [...set.values, user.id],
  );
  const updated = rows[0];

  if (data.role && data.role !== user.role) {
    await audit({ by: req.user, action: 'cambio de permisos', entityType: 'usuario', entityLabel: updated.name, detail: `${user.role} → ${data.role}` });
  }
  if (data.commissionRate !== undefined && Number(data.commissionRate ?? -1) !== Number(user.commission_rate ?? -1)) {
    await audit({
      by: req.user, action: 'cambio de comisión', entityType: 'usuario', entityLabel: updated.name,
      detail: `${user.commission_rate ?? 'por defecto'}% → ${data.commissionRate ?? 'por defecto'}%`,
    });
  }
  const other = ['name', 'username', 'email', 'password'].filter((k) => data[k] !== undefined);
  if (other.length) {
    await audit({ by: req.user, action: 'edición', entityType: 'usuario', entityLabel: updated.name, detail: `Campos: ${other.join(', ')}` });
  }
  realtime.notifyChange('users');
  res.json(mapUser(updated, { full: true }));
}));

// Al eliminar un usuario, TODOS sus registros se reasignan a quien lo elimina: nunca quedan huérfanos.
router.delete('/:id', ah(async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta');
  const result = await db.tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    const user = rows[0];
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    const counts = {};
    for (const table of ['companies', 'contacts', 'deals', 'tasks']) {
      const r = await client.query(`UPDATE ${table} SET assigned_to = $1, updated_at = now() WHERE assigned_to = $2`, [req.user.id, user.id]);
      counts[table] = r.rowCount;
    }
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    const moved = Object.values(counts).reduce((a, b) => a + b, 0);
    if (moved) {
      await audit({
        client, by: req.user, action: 'cambio de responsable', entityType: 'usuario', entityLabel: user.name,
        detail: `Reasignados a ${req.user.name}: ${counts.companies} empresas, ${counts.contacts} contactos, ${counts.deals} negocios, ${counts.tasks} tareas`,
      });
    }
    await audit({ client, by: req.user, action: 'eliminación', entityType: 'usuario', entityLabel: user.name, detail: user.email });
    return { reassigned: counts };
  });
  realtime.notifyChange('all');
  res.json(result);
}));

module.exports = router;
