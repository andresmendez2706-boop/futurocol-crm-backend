'use strict';

// Alerta de leads duplicados: contactos que comparten el mismo correo (sin importar mayúsculas
// ni espacios) o el mismo teléfono (solo dígitos; con 10 o más dígitos se comparan los últimos 10,
// así "+57 300 123 4567" y "3001234567" son el mismo número).
//
// Los contactos que coinciden en correo o teléfono se agrupan (si A=B por teléfono y B=C por
// correo, A, B y C forman un solo grupo). El asesor ve los grupos donde está alguno de sus
// contactos; de los contactos de otros asesores solo ve que existen y quién los tiene.

const db = require('../db');
const { isAdmin } = require('../permissions');

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

async function findDuplicateGroups(viewer, client = db) {
  const { rows: keys } = await client.query(
    `WITH k AS (
       SELECT id, 'correo' AS kind, lower(trim(email)) AS val FROM contacts WHERE coalesce(trim(email), '') <> ''
       UNION ALL
       SELECT id, 'teléfono', right(regexp_replace(phone, '\\D', '', 'g'), 10) FROM contacts
        WHERE length(regexp_replace(coalesce(phone, ''), '\\D', '', 'g')) >= 7
     )
     SELECT kind, val, array_agg(id ORDER BY id) AS ids FROM k GROUP BY kind, val HAVING count(*) > 1`,
  );
  if (!keys.length) return [];

  // Unión de grupos que comparten contactos.
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(x, r);
    return r;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const k of keys) for (const id of k.ids.slice(1)) union(k.ids[0], id);

  const ids = [...parent.keys()];
  const { rows: contacts } = await client.query(
    `SELECT c.id, c.name, c.email, c.phone, c.assigned_to, c.created_at, u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ANY($1::text[]) ORDER BY c.created_at`,
    [ids],
  );

  const groups = new Map();
  for (const c of contacts) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, { contacts: [], matches: new Set() });
    groups.get(root).contacts.push(c);
  }
  for (const k of keys) groups.get(find(k.ids[0]))?.matches.add(k.kind);

  const admin = isAdmin(viewer);
  const out = [];
  for (const g of groups.values()) {
    if (!admin && !g.contacts.some((c) => c.assigned_to === viewer.id)) continue;
    out.push({
      matches: [...g.matches],
      contacts: g.contacts.map((c) => {
        const visible = admin || c.assigned_to === viewer.id;
        return {
          id: visible ? c.id : null,
          name: visible ? c.name : 'Contacto de otro asesor',
          email: visible ? c.email : null,
          phone: visible ? c.phone : null,
          owner: c.owner_name || '—',
          createdAt: iso(c.created_at),
        };
      }),
    });
  }
  // Los grupos con el contacto más reciente primero.
  out.sort((a, b) => String(b.contacts.at(-1).createdAt).localeCompare(String(a.contacts.at(-1).createdAt)));
  return out;
}

module.exports = { findDuplicateGroups };
