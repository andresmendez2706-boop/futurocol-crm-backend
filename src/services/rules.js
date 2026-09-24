'use strict';

// Reglas de negocio puras (sin base de datos), fáciles de probar.

const { CLOSED_STAGES, WON, LOST } = require('../constants');

// Probabilidad efectiva: la manual del negocio o, si no tiene, la de su etapa.
function dealProbability(deal, stages) {
  if (deal.probability !== null && deal.probability !== undefined && deal.probability !== '') return Number(deal.probability);
  const st = stages.find((s) => s.id === deal.stage);
  return st ? Number(st.probability) : 0;
}

// Tasa efectiva de un usuario: su tasa individual o la por defecto de su rol.
function effectiveRate(user, commissions) {
  if (user.commissionRate !== null && user.commissionRate !== undefined && user.commissionRate !== '') {
    return Number(user.commissionRate);
  }
  return Number(user.role === 'admin' ? commissions.adminDefault : commissions.asesorDefault) || 0;
}

// Fecha que cuenta para la facturación de un negocio ganado.
function billingDate(deal) {
  if (deal.closeDate) return String(deal.closeDate).slice(0, 10);
  const won = [...(deal.stageHistory || [])].reverse().find((h) => h.stage === WON);
  if (won?.at) return new Date(won.at).toISOString().slice(0, 10);
  return deal.createdAt ? new Date(deal.createdAt).toISOString().slice(0, 10) : null;
}

// period: { type: 'all' } | { type: 'year', year } | { type: 'month', year, month (1-12) }
function parsePeriod(q = {}) {
  const type = q.type || q.periodType || 'all';
  const year = Number(q.year);
  const month = Number(q.month);
  if (type === 'month' && year && month >= 1 && month <= 12) return { type, year, month };
  if (type === 'year' && year) return { type, year };
  return { type: 'all' };
}

function inPeriod(isoDate, period) {
  if (!period || period.type === 'all') return true;
  if (!isoDate) return false;
  const [y, m] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (period.type === 'year') return y === period.year;
  return y === period.year && m === period.month;
}

const isWon = (d) => d.stage === WON;
const isLost = (d) => d.stage === LOST;
const isOpen = (d) => !CLOSED_STAGES.includes(d.stage);

// Semáforo de una tarea (se calcula, no se guarda).
function taskLight(task, today) {
  if (task.done) return 'verde';
  if (!task.dueDate) return 'verde';
  const due = String(task.dueDate).slice(0, 10);
  if (due < today) return 'rojo';
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  const tomorrow = t.toISOString().slice(0, 10);
  if (due <= tomorrow) return 'amarillo';
  return 'verde';
}

/**
 * Comisiones del período.
 *  - Asesor: su tasa individual × facturación de los negocios GANADOS que él mismo cerró.
 *  - Admin: comisión de GERENCIA = su tasa × facturación TOTAL de la academia (todos, incluido él),
 *    calculada mes a mes y sumada. No depende de sus propias ventas.
 * Se devuelven por separado, nunca sumadas.
 */
function computeCommissions({ users, deals, commissions, period }) {
  const won = deals.filter((d) => isWon(d) && inPeriod(billingDate(d), period));
  const byUser = new Map();
  for (const d of won) byUser.set(d.assignedTo, (byUser.get(d.assignedTo) || 0) + Number(d.value || 0));
  const totalBilling = won.reduce((s, d) => s + Number(d.value || 0), 0);

  // Facturación total por mes (para la comisión de gerencia "mes a mes").
  const byMonth = new Map();
  for (const d of won) {
    const k = billingDate(d).slice(0, 7);
    byMonth.set(k, (byMonth.get(k) || 0) + Number(d.value || 0));
  }

  const asesores = users.filter((u) => u.role === 'asesor').map((u) => {
    const rate = effectiveRate(u, commissions);
    const billing = byUser.get(u.id) || 0;
    return { userId: u.id, name: u.name, rate, billing, commission: round2((billing * rate) / 100) };
  });

  const admins = users.filter((u) => u.role === 'admin').map((u) => {
    const rate = effectiveRate(u, commissions);
    const monthly = [...byMonth.entries()].sort().map(([month, billing]) => ({
      month, billing, commission: round2((billing * rate) / 100),
    }));
    return {
      userId: u.id,
      name: u.name,
      rate,
      ownBilling: byUser.get(u.id) || 0, // informativo: NO se usa para su comisión
      baseBilling: totalBilling,
      commission: round2(monthly.reduce((s, m) => s + m.commission, 0)),
      monthly,
    };
  });

  return {
    totalBilling,
    asesores,
    admins,
    asesoresTotal: round2(asesores.reduce((s, a) => s + a.commission, 0)),
    adminTotal: round2(admins.reduce((s, a) => s + a.commission, 0)),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  dealProbability, effectiveRate, billingDate, parsePeriod, inPeriod, isWon, isLost, isOpen,
  taskLight, computeCommissions, round2,
};
