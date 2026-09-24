'use strict';

// Lectura de datos ya mapeados al formato de la API, siempre filtrados por el alcance del usuario.

const db = require('../db');
const { isAdmin } = require('../permissions');
const {
  mapUser, mapCompany, mapContact, mapDeal, mapTask, mapMessage,
} = require('../util');

async function listUsers(viewer) {
  const { rows } = await db.query('SELECT * FROM users ORDER BY name');
  // La tasa de comisión solo la ven el admin (de todos) y cada usuario (la suya).
  return rows.map((r) => {
    const u = mapUser(r, { full: isAdmin(viewer) || r.id === viewer.id });
    return u;
  });
}

async function listAllUsersFull(client = db) {
  const { rows } = await client.query('SELECT * FROM users ORDER BY name');
  return rows.map((r) => mapUser(r, { full: true }));
}

async function listCompanies(viewer) {
  if (isAdmin(viewer)) {
    const { rows } = await db.query('SELECT * FROM companies ORDER BY name');
    return rows.map(mapCompany);
  }
  // Asesor: sus empresas + las empresas vinculadas a sus contactos (solo lectura para él).
  const { rows } = await db.query(
    `SELECT * FROM companies WHERE assigned_to = $1
       OR id IN (SELECT company_id FROM contacts WHERE assigned_to = $1 AND company_id IS NOT NULL)
     ORDER BY name`,
    [viewer.id],
  );
  return rows.map(mapCompany);
}

async function listContacts(viewer) {
  const { rows } = isAdmin(viewer)
    ? await db.query('SELECT * FROM contacts ORDER BY created_at DESC')
    : await db.query('SELECT * FROM contacts WHERE assigned_to = $1 ORDER BY created_at DESC', [viewer.id]);
  return rows.map(mapContact);
}

async function listDeals(viewer) {
  const { rows } = isAdmin(viewer)
    ? await db.query('SELECT * FROM deals ORDER BY created_at DESC')
    : await db.query('SELECT * FROM deals WHERE assigned_to = $1 ORDER BY created_at DESC', [viewer.id]);
  return rows.map(mapDeal);
}

async function listAllDeals(client = db) {
  const { rows } = await client.query('SELECT * FROM deals');
  return rows.map(mapDeal);
}

async function listTasks(viewer) {
  // Admin: ve todas (solo lectura sobre las ajenas). Asesor: las suyas.
  const { rows } = isAdmin(viewer)
    ? await db.query('SELECT * FROM tasks ORDER BY due_date NULLS LAST, created_at')
    : await db.query('SELECT * FROM tasks WHERE assigned_to = $1 ORDER BY due_date NULLS LAST, created_at', [viewer.id]);
  return rows.map(mapTask);
}

async function listMessages(viewer) {
  const { rows } = await db.query(
    'SELECT * FROM messages WHERE from_user = $1 OR to_user = $1 ORDER BY at',
    [viewer.id],
  );
  return rows.map(mapMessage);
}

async function getRow(table, id, client = db) {
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return rows[0] || null;
}

module.exports = {
  listUsers, listAllUsersFull, listCompanies, listContacts, listDeals, listAllDeals, listTasks, listMessages, getRow,
};
