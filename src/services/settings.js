'use strict';

const db = require('../db');
const { DEFAULT_STAGES, DEFAULT_COMMISSIONS, PROTECTED_STAGES } = require('../constants');
const { HttpError } = require('../util');

async function get(key, fallback, client = db) {
  const { rows } = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function set(key, value, client = db) {
  await client.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

const getStages = (client) => get('stages', DEFAULT_STAGES, client).then(normalizeStages);
const getCommissions = (client) =>
  get('commissions', DEFAULT_COMMISSIONS, client).then((c) => ({ ...DEFAULT_COMMISSIONS, ...c }));

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'etapa';

// Normaliza el catálogo de etapas: IDs únicos, etapas protegidas siempre presentes y al final
// (en orden aplazado → ganado → perdido), con su comportamiento fijo.
function normalizeStages(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const open = [];
  const prot = {};
  for (const raw of list) {
    if (!raw) continue;
    const label = String(raw.label ?? raw.name ?? raw.id ?? '').trim();
    let id = String(raw.id || slug(label)).trim();
    if (!id || !label) continue;
    if (PROTECTED_STAGES.includes(id)) {
      prot[id] = { id, label, probability: DEFAULT_STAGES.find((s) => s.id === id).probability, protected: true };
      continue;
    }
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    let probability = Number(raw.probability);
    if (!Number.isFinite(probability)) probability = DEFAULT_STAGES.find((s) => s.id === id)?.probability ?? 50;
    open.push({ id, label, probability: Math.max(0, Math.min(100, Math.round(probability))), protected: false });
  }
  for (const pid of PROTECTED_STAGES) {
    if (!prot[pid]) {
      const d = DEFAULT_STAGES.find((s) => s.id === pid);
      prot[pid] = { ...d, protected: true };
    }
  }
  return [...open, ...PROTECTED_STAGES.map((p) => prot[p])];
}

function validateStagesInput(stages) {
  if (!Array.isArray(stages) || stages.length === 0) throw new HttpError(400, 'Lista de etapas inválida');
  const open = stages.filter((s) => !PROTECTED_STAGES.includes(s.id));
  if (open.length === 0) throw new HttpError(400, 'Debe existir al menos una etapa abierta');
  const seen = new Set();
  for (const s of stages) {
    const label = String(s.label || '').trim().toLowerCase();
    if (!label) throw new HttpError(400, 'Todas las etapas necesitan un nombre');
    if (seen.has(label)) throw new HttpError(400, `Hay dos etapas con el nombre "${s.label.trim()}"`);
    seen.add(label);
  }
}

module.exports = { get, set, getStages, getCommissions, normalizeStages, validateStagesInput, slug };
