'use strict';

// Cálculos del Panel, Reportes y Embudo. Se hacen en el servidor para que las cifras
// (especialmente las comisiones) sean las mismas para todos y no dependan del navegador.

const db = require('../db');
const repo = require('./repo');
const settings = require('./settings');
const { isAdmin } = require('../permissions');
const {
  WON, CLOSED_STAGES, EXPENSE_CATEGORIES, PROFIT_THRESHOLDS,
} = require('../constants');
const {
  dealProbability, billingDate, inPeriod, isWon, isLost, isOpen, computeCommissions, taskLight, round2, effectiveRate, profitability,
} = require('./rules');
const { todayISO, mapTask, mapExpense } = require('../util');
const { listAllies } = require('./allies');

const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
const monthKey = (d) => String(d).slice(0, 7);

function lastMonths(n, today) {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// Etapa de un lead = etapa de su negocio más reciente; sin negocios = primera etapa ("Lead nuevo").
function leadStages(contacts, deals, stages) {
  const latest = new Map();
  for (const d of deals) {
    if (!d.contactId) continue;
    const prev = latest.get(d.contactId);
    if (!prev || new Date(d.createdAt) > new Date(prev.createdAt)) latest.set(d.contactId, d);
  }
  const first = stages[0]?.id;
  return contacts.map((c) => ({ contactId: c.id, stage: latest.get(c.id)?.stage || first }));
}

function closeDateOf(d) {
  if (d.closeDate) return String(d.closeDate).slice(0, 10);
  const h = [...(d.stageHistory || [])].reverse().find((x) => x.stage === d.stage);
  return h?.at ? new Date(h.at).toISOString().slice(0, 10) : null;
}

// Filtro opcional por aliado (CUN, UNIR…); sin aliado = vista unificada de Futurocol.
const byAlly = (allyId) => (r) => !allyId || r.allyId === allyId;

async function dashboard(viewer, period, allyId = null) {
  const [stages, commissionsCfg, allContacts, allViewerDeals, allUsers, allies] = await Promise.all([
    settings.getStages(), settings.getCommissions(), repo.listContacts(viewer), repo.listDeals(viewer),
    repo.listAllUsersFull(), listAllies(),
  ]);
  const contacts = allContacts.filter(byAlly(allyId));
  const deals = allViewerDeals.filter(byAlly(allyId));
  const admin = isAdmin(viewer);
  const today = todayISO();
  const open = deals.filter(isOpen);
  const wonPeriod = deals.filter((d) => isWon(d) && inPeriod(billingDate(d), period));

  // Las comisiones se calculan SIEMPRE con todos los negocios (la del admin depende del total),
  // pero al asesor solo se le devuelve la suya.
  const allDeals = admin ? deals : (await repo.listAllDeals()).filter(byAlly(allyId));
  const comm = computeCommissions({ users: allUsers, deals: allDeals, commissions: commissionsCfg, period, allies });

  // Contactos (leads) creados en el período seleccionado; "General" = todos.
  const periodContacts = contacts.filter((c) => inPeriod(new Date(c.createdAt).toISOString().slice(0, 10), period));

  const cards = {
    contacts: periodContacts.length,
    contactsTotal: contacts.length,
    openDeals: open.length,
    openValue: sum(open, (d) => d.value),
    wonCount: wonPeriod.length,
    billing: sum(wonPeriod, (d) => d.value),
  };
  if (admin) {
    cards.weightedPipeline = round2(sum(open, (d) => (Number(d.value) * dealProbability(d, stages)) / 100));
    cards.asesoresCommission = comm.asesoresTotal;
    const me = comm.admins.find((a) => a.userId === viewer.id);
    cards.adminCommission = me ? me.commission : comm.adminTotal;
    cards.adminRate = me ? me.rate : null;
    cards.academyBilling = comm.totalBilling;
    // Ganancia de Futurocol por aliado en el período
    cards.byAlly = allies.filter((a) => !allyId || a.id === allyId).map((a) => {
      const billing = wonPeriod.filter((d) => d.allyId === a.id).reduce((s, d) => s + Number(d.value || 0), 0);
      return { allyId: a.id, name: a.name, rate: a.commissionRate, billing, earnings: round2((billing * a.commissionRate) / 100) };
    });
  } else {
    const me = comm.asesores.find((a) => a.userId === viewer.id);
    cards.myCommission = me ? me.commission : 0;
    cards.myRate = me ? me.rate : null;
  }

  const months = lastMonths(6, today);
  const wonAll = deals.filter(isWon);
  const billing6 = months.map((m) => ({
    month: m,
    value: sum(wonAll.filter((d) => monthKey(billingDate(d)) === m), (d) => d.value),
  }));

  const ls = leadStages(periodContacts, deals, stages);
  const leadsByStage = stages.map((s) => ({ stage: s.id, label: s.label, count: ls.filter((l) => l.stage === s.id).length }));
  const dealsByStage = stages.map((s) => {
    const ds = deals.filter((d) => d.stage === s.id);
    return { stage: s.id, label: s.label, count: ds.length, value: sum(ds, (d) => d.value) };
  });

  let perAsesor = null;
  if (admin) {
    perAsesor = comm.asesores.map((a) => ({
      userId: a.userId,
      name: a.name,
      leads: periodContacts.filter((c) => c.assignedTo === a.userId).length,
      deals: deals.filter((d) => d.assignedTo === a.userId).length,
      openDeals: open.filter((d) => d.assignedTo === a.userId).length,
      won: wonPeriod.filter((d) => d.assignedTo === a.userId).length,
      billing: a.billing,
      rate: a.rate,
      commission: a.commission,
    }));
  }

  // Actividad reciente: bitácoras de contactos + cambios de etapa, dentro del alcance del usuario.
  const recent = [];
  for (const c of contacts) {
    for (const a of c.activity || []) {
      recent.push({ kind: 'activity', type: a.type, text: a.text, by: a.author, at: a.at, contactId: c.id, label: c.name });
    }
  }
  for (const d of deals) {
    for (const h of d.stageHistory || []) {
      recent.push({ kind: 'stage', stage: h.stage, from: h.from, by: h.by, at: h.at, dealId: d.id, label: d.title });
    }
  }
  recent.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    period, cards, billing6, leadsByStage, dealsByStage, perAsesor, recent: recent.slice(0, 15),
    commissions: admin ? { asesores: comm.asesores, admins: comm.admins } : undefined,
  };
}

async function reports(period, allyId = null) {
  const admin = { role: 'admin' };
  const [allContacts, allDeals, users, commissionsCfg, taskRows, allies] = await Promise.all([
    repo.listContacts(admin), repo.listDeals(admin), repo.listAllUsersFull(), settings.getCommissions(),
    db.query('SELECT * FROM tasks WHERE done = false AND due_date IS NOT NULL'), listAllies(),
  ]);
  const contacts = allContacts.filter(byAlly(allyId));
  const deals = allDeals.filter(byAlly(allyId));
  const today = todayISO();
  const won = deals.filter((d) => isWon(d) && inPeriod(billingDate(d), period));
  const lost = deals.filter((d) => isLost(d) && inPeriod(closeDateOf(d), period));
  const createdInPeriod = (x) => inPeriod(new Date(x.createdAt).toISOString().slice(0, 10), period);
  const periodContacts = contacts.filter(createdInPeriod);
  const periodDeals = deals.filter(createdInPeriod);

  const lossReasons = {};
  for (const d of lost) {
    const r = (d.lossReason || 'Sin motivo').trim();
    (lossReasons[r] ||= []).push(d.id);
  }

  const wonContactIds = new Set(deals.filter(isWon).map((d) => d.contactId));
  const convertedLeads = periodContacts.filter((c) => wonContactIds.has(c.id));

  const byAsesor = users.map((u) => {
    const mine = periodDeals.filter((d) => d.assignedTo === u.id);
    const w = won.filter((d) => d.assignedTo === u.id);
    const l = lost.filter((d) => d.assignedTo === u.id);
    return {
      userId: u.id, name: u.name, role: u.role,
      deals: mine.map((d) => d.id), won: w.map((d) => d.id), lost: l.map((d) => d.id),
      billing: sum(w, (d) => d.value),
      leads: periodContacts.filter((c) => c.assignedTo === u.id).map((c) => c.id),
    };
  });

  const byProgram = {};
  for (const c of periodContacts) (byProgram[c.program || 'Sin programa'] ||= []).push(c.id);

  const overdue = taskRows.rows.map(mapTask).filter((t) => taskLight(t, today) === 'rojo');
  const billing = sum(won, (d) => d.value);
  const comm = computeCommissions({ users, deals, commissions: commissionsCfg, period, allies });

  return {
    period,
    won: { ids: won.map((d) => d.id), count: won.length, value: billing },
    lost: { ids: lost.map((d) => d.id), count: lost.length, value: sum(lost, (d) => d.value), reasons: lossReasons },
    winRate: won.length + lost.length ? round2((won.length / (won.length + lost.length)) * 100) : 0,
    leadConversion: {
      leads: periodContacts.map((c) => c.id),
      converted: convertedLeads.map((c) => c.id),
      rate: periodContacts.length ? round2((convertedLeads.length / periodContacts.length) * 100) : 0,
    },
    avgTicket: won.length ? round2(billing / won.length) : 0,
    byAsesor,
    byProgram,
    overdueTasks: overdue.map((t) => t.id),
    overdueTaskRecords: overdue,
    commissions: { asesores: comm.asesores, admins: comm.admins, asesoresTotal: comm.asesoresTotal, adminTotal: comm.adminTotal },
  };
}

// Embudo de conversión: cuántos negocios alcanzaron cada etapa (según su historial).
async function funnel(viewer, { userId, period, allyId } = {}) {
  const stages = await settings.getStages();
  let deals = (await repo.listDeals(viewer)).filter(byAlly(allyId));
  if (isAdmin(viewer) && userId) deals = deals.filter((d) => d.assignedTo === userId);
  if (period && period.type !== 'all') {
    deals = deals.filter((d) => inPeriod(new Date(d.createdAt).toISOString().slice(0, 10), period));
  }
  const flow = [...stages.filter((s) => !CLOSED_STAGES.includes(s.id)), stages.find((s) => s.id === WON)];
  const index = new Map(flow.map((s, i) => [s.id, i]));
  const reached = deals.map((d) => {
    if (d.stage === WON) return flow.length - 1;
    let max = -1;
    for (const st of [d.stage, ...(d.stageHistory || []).flatMap((h) => [h.stage, h.from])]) {
      if (index.has(st) && st !== WON) max = Math.max(max, index.get(st));
    }
    return max === -1 ? 0 : max;
  });
  const steps = flow.map((s, i) => {
    const ids = deals.filter((_, k) => reached[k] >= i).map((d) => d.id);
    return { stage: s.id, label: s.label, count: ids.length, ids };
  });
  steps.forEach((s, i) => {
    s.conversionFromPrev = i === 0 ? 100 : steps[i - 1].count ? round2((s.count / steps[i - 1].count) * 100) : 0;
    s.conversionFromStart = steps[0].count ? round2((s.count / steps[0].count) * 100) : 0;
  });
  return {
    steps,
    total: deals.length,
    lost: deals.filter(isLost).map((d) => d.id),
    postponed: deals.filter((d) => d.stage === 'aplazado').map((d) => d.id),
  };
}

/**
 * Balance financiero del admin, mes a mes:
 *   ganancia admin  = tasa del admin × facturación total del mes
 *   comisión asesor = tasa de cada asesor × lo que él facturó ese mes
 *   gastos          = gastos de operación del mes (marketing, planes móviles…), ingresados a mano
 *   ganancia neta   = ganancia admin − comisiones de asesores − gastos
 *   rentabilidad    = ganancia neta ÷ ganancia admin (semáforo excelente / bueno / muy malo)
 * scope: { year } → los 12 meses de ese año · { all: true } → todos los meses con movimiento hasta hoy.
 */
async function finance(viewer, { year, all = false, allyId = null } = {}) {
  const [users, allDeals, commissionsCfg, expenseRows, allies] = await Promise.all([
    repo.listAllUsersFull(), repo.listAllDeals(), settings.getCommissions(),
    all ? db.query('SELECT * FROM expenses ORDER BY year, month, created_at')
      : db.query('SELECT * FROM expenses WHERE year = $1 ORDER BY month, created_at', [year]),
    listAllies(),
  ]);
  const deals = allDeals.filter(byAlly(allyId));
  // Con un aliado elegido solo cuentan los gastos de ese aliado; en la vista unificada, todos.
  const expenses = expenseRows.rows.map(mapExpense).filter((e) => !allyId || e.allyId === allyId);
  const me = users.find((u) => u.id === viewer.id) || { ...viewer, role: 'admin' };
  const adminRate = effectiveRate(me, commissionsCfg);
  const rateOf = (id) => (allies.find((a) => a.id === id)?.commissionRate ?? adminRate);
  const won = deals.filter(isWon);

  // Meses a calcular
  let periods = [];
  if (all) {
    const keys = [...won.map((d) => billingDate(d)?.slice(0, 7)), ...expenses.map((e) => `${e.year}-${String(e.month).padStart(2, '0')}`)]
      .filter(Boolean).sort();
    if (keys.length) {
      let [y, m] = keys[0].split('-').map(Number);
      const [ly, lm] = [keys[keys.length - 1], todayISO().slice(0, 7)].sort().pop().split('-').map(Number);
      while (y < ly || (y === ly && m <= lm)) {
        periods.push({ year: y, month: m });
        m += 1;
        if (m > 12) { m = 1; y += 1; }
      }
    }
  } else {
    periods = [...Array(12)].map((_, i) => ({ year, month: i + 1 }));
  }

  const months = periods.map(({ year: y, month }) => {
    const period = { type: 'month', year: y, month };
    const comm = computeCommissions({ users, deals, commissions: commissionsCfg, period, allies });
    const monthWon = won.filter((d) => inPeriod(billingDate(d), period));
    // Ganancia de Futurocol = % de cada aliado × lo facturado de ese aliado
    const allyRows = allies.filter((a) => !allyId || a.id === allyId).map((a) => {
      const billing = monthWon.filter((d) => d.allyId === a.id).reduce((s, d) => s + Number(d.value || 0), 0);
      const aExpenses = expenses.filter((e) => e.year === y && e.month === month && e.allyId === a.id)
        .reduce((s, e) => s + Number(e.amount), 0);
      return { allyId: a.id, name: a.name, rate: a.commissionRate, billing, gross: round2((billing * a.commissionRate) / 100), expenses: round2(aExpenses), commission: 0 };
    });
    const noAlly = monthWon.filter((d) => !d.allyId || !allies.some((a) => a.id === d.allyId));
    const adminGross = round2(allyRows.reduce((s, a) => s + a.gross, 0)
      + noAlly.reduce((s, d) => s + (Number(d.value || 0) * rateOf(d.allyId)) / 100, 0));
    // Comisión de asesores por aliado (tasa individual × sus ventas de ese aliado)
    const rateOfUser = new Map(comm.asesores.map((a) => [a.userId, a.rate]));
    for (const a of allyRows) {
      a.commission = round2(monthWon.filter((d) => d.allyId === a.allyId && rateOfUser.has(d.assignedTo))
        .reduce((s, d) => s + (Number(d.value || 0) * rateOfUser.get(d.assignedTo)) / 100, 0));
      a.net = round2(a.gross - a.commission - a.expenses);
    }
    const monthExpenses = expenses.filter((e) => e.year === y && e.month === month);
    const expensesTotal = round2(monthExpenses.reduce((acc, e) => acc + Number(e.amount), 0));
    const afterCommissions = round2(adminGross - comm.asesoresTotal);
    const row = {
      year: y,
      month,
      billing: comm.totalBilling,
      wonCount: monthWon.length,
      dealIds: monthWon.map((d) => d.id),
      adminGross,
      asesoresCommission: comm.asesoresTotal,
      afterCommissions,
      expenses: monthExpenses,
      expensesTotal,
      net: round2(afterCommissions - expensesTotal),
      byAlly: allyRows,
      asesores: comm.asesores.map((a) => ({
        ...a, dealIds: monthWon.filter((d) => d.assignedTo === a.userId).map((d) => d.id),
      })),
    };
    return { ...row, ...profitability(row, PROFIT_THRESHOLDS) };
  });

  const total = (k) => round2(months.reduce((acc, m) => acc + m[k], 0));
  const totals = {
    billing: total('billing'), adminGross: total('adminGross'),
    asesoresCommission: total('asesoresCommission'), afterCommissions: total('afterCommissions'),
    expensesTotal: total('expensesTotal'), net: total('net'),
    wonCount: months.reduce((acc, m) => acc + m.wonCount, 0),
  };
  const allyTotals = allies.filter((a) => !allyId || a.id === allyId).map((a) => {
    const rows = months.map((m) => m.byAlly.find((x) => x.allyId === a.id)).filter(Boolean);
    const t = (k) => round2(rows.reduce((s, x) => s + x[k], 0));
    return { allyId: a.id, name: a.name, rate: a.commissionRate, billing: t('billing'), gross: t('gross'), commission: t('commission'), expenses: t('expenses'), net: t('net') };
  });
  return {
    year: all ? null : year,
    all,
    allyId,
    adminRate,
    allies: allies.map((a) => ({ id: a.id, name: a.name, rate: a.commissionRate })),
    byAlly: allyTotals,
    thresholds: PROFIT_THRESHOLDS,
    expenseCategories: EXPENSE_CATEGORIES,
    months,
    totals: { ...totals, ...profitability(totals, PROFIT_THRESHOLDS) },
  };
}

module.exports = { dashboard, reports, funnel, finance, leadStages, lastMonths, closeDateOf };
