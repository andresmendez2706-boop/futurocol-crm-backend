'use strict';

const crypto = require('crypto');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

// Fecha 'YYYY-MM-DD' en la zona horaria del negocio.
function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const digits = (s) => String(s || '').replace(/\D/g, '');

// Envuelve handlers async para Express 4.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Mapeo filas (snake_case) → objetos de la API (camelCase, igual que el CRM original) ----
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

const mapUser = (r, { full = false } = {}) => {
  const u = { id: r.id, name: r.name, username: r.username, email: r.email, role: r.role, createdAt: iso(r.created_at) };
  if (full) u.commissionRate = r.commission_rate;
  return u;
};

const mapCompany = (r) => ({
  id: r.id, name: r.name, nit: r.nit, domain: r.domain, phone: r.phone, email: r.email, address: r.address,
  city: r.city, department: r.department, country: r.country, sector: r.sector, employees: r.employees,
  source: r.source, notes: r.notes, assignedTo: r.assigned_to, createdAt: iso(r.created_at),
});

const mapContact = (r) => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, companyId: r.company_id, program: r.program,
  city: r.city, notes: r.notes, assignedTo: r.assigned_to, createdAt: iso(r.created_at), activity: r.activity || [],
});

const mapDeal = (r) => ({
  id: r.id, title: r.title, contactId: r.contact_id, value: r.value, stage: r.stage, dealType: r.deal_type,
  product: r.product, convocatoria: r.convocatoria, probability: r.probability,
  expectedCloseDate: r.expected_close_date, closeDate: r.close_date, competitor: r.competitor,
  nextStep: r.next_step, lossReason: r.loss_reason, assignedTo: r.assigned_to, createdAt: iso(r.created_at),
  stageHistory: r.stage_history || [],
});

const mapTask = (r) => ({
  id: r.id, contactId: r.contact_id, dealId: r.deal_id, title: r.title, type: r.type, dueDate: r.due_date,
  contactTime: r.contact_time, scheduleTime: r.schedule_time, notes: r.notes, done: r.done,
  completedAt: iso(r.completed_at), assignedTo: r.assigned_to, createdAt: iso(r.created_at), autoRule: r.auto_rule,
});

const mapMessage = (r) => ({ id: r.id, from: r.from_user, to: r.to_user, text: r.text, at: iso(r.at) });

const mapAudit = (r) => ({
  id: r.id, at: iso(r.at), by: r.by_name, byUserId: r.by_user_id, action: r.action,
  entityType: r.entity_type, entityLabel: r.entity_label, detail: r.detail,
});

const mapExpense = (r) => ({
  id: r.id, year: r.year, month: r.month, category: r.category, description: r.description, amount: r.amount,
  createdBy: r.created_by, createdAt: iso(r.created_at),
});

// Construye "SET a=$1, b=$2" a partir de un objeto { columna: valor } (solo claves definidas).
function buildSet(fields, startIndex = 1) {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  return {
    sql: cols.map((c, i) => `${c} = $${i + startIndex}`).join(', '),
    values: cols.map((c) => fields[c]),
    count: cols.length,
  };
}

module.exports = {
  HttpError, newId, todayISO, addDaysISO, digits, ah, buildSet,
  mapUser, mapCompany, mapContact, mapDeal, mapTask, mapMessage, mapAudit, mapExpense,
};
