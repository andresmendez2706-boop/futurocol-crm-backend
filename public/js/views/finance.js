import {
  S, api, esc, icon, money, compactMoney, pct, options, MONTHS, MONTHS_SHORT,
} from '../core.js';
import {
  emptyState, formModal, confirmDialog, alertDialog, toast,
} from '../ui.js';
import { drillDeals } from './reports.js';

export const id = 'finanzas';
export const title = 'Balance financiero';
export const navIcon = 'finanzas';
export const adminOnly = true;

// Vista: 'mes' (un mes) · 'anio' (meses del año) · 'general' (todos los meses con movimiento)
const ui = () => {
  if (!S.ui.finance) {
    const [y, m] = S.today.split('-').map(Number);
    const p = S.period;
    S.ui.finance = p?.type === 'month' ? { mode: 'mes', year: p.year, month: p.month } : { mode: 'mes', year: p?.year || y, month: m };
  }
  return S.ui.finance;
};

const LEVELS = {
  excelente: { label: 'Excelente', dot: 'dot-verde' },
  bueno: { label: 'Bueno', dot: 'dot-amarillo' },
  'muy-malo': { label: 'Muy malo', dot: 'dot-rojo' },
  'sin-datos': { label: 'Sin movimiento', dot: 'dot-gris' },
};

// Misma regla que el servidor (services/rules.js → profitability)
function profitability(r, th) {
  if (!r.billing && !r.expensesTotal && !r.asesoresCommission) return { margin: null, level: 'sin-datos' };
  if (!(r.adminGross > 0)) return { margin: null, level: 'muy-malo' };
  const margin = Math.round((r.net / r.adminGross) * 10000) / 100;
  return { margin, level: margin >= th.excelente ? 'excelente' : margin >= th.bueno ? 'bueno' : 'muy-malo' };
}

const light = (p, { big = false } = {}) => {
  const l = LEVELS[p.level];
  return `<span class="profit ${big ? 'big' : ''}"><span class="dot ${l.dot}"></span>${p.margin === null ? '—' : pct(p.margin)} <small>${l.label}</small></span>`;
};
const neg = (n) => (n < 0 ? ' negative' : '');
const monthLabel = (r, short = false) => `${(short ? MONTHS_SHORT : MONTHS)[r.month - 1]} ${short ? String(r.year).slice(2) : r.year}`;
const hasActivity = (r) => r.billing || r.expensesTotal || r.asesoresCommission;

function scopeRows(f) {
  const u = ui();
  const [cy, cm] = S.today.split('-').map(Number);
  if (u.mode === 'mes') return f.months.filter((r) => r.month === u.month);
  if (u.mode === 'anio') return f.months.filter((r) => r.year < cy || r.month <= cm || hasActivity(r));
  return f.months;
}

function aggregate(rows, th) {
  const sum = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
  const r = {
    billing: sum('billing'), adminGross: sum('adminGross'), asesoresCommission: sum('asesoresCommission'),
    expensesTotal: sum('expensesTotal'), net: sum('net'), wonCount: sum('wonCount'),
    dealIds: rows.flatMap((x) => x.dealIds), expenses: rows.flatMap((x) => x.expenses),
  };
  const asesores = new Map();
  for (const row of rows) {
    for (const a of row.asesores) {
      const cur = asesores.get(a.userId) || { userId: a.userId, name: a.name, rate: a.rate, billing: 0, commission: 0, dealIds: [] };
      cur.billing += a.billing;
      cur.commission += a.commission;
      cur.dealIds.push(...a.dealIds);
      cur.rate = a.rate;
      asesores.set(a.userId, cur);
    }
  }
  r.asesores = [...asesores.values()].filter((a) => a.billing || a.commission);
  return { ...r, ...profitability(r, th) };
}

export async function render() {
  const u = ui();
  const f = await api('GET', u.mode === 'general' ? '/api/admin/finance?all=1' : `/api/admin/finance?year=${u.year}`);
  const rows = scopeRows(f);
  const sum = u.mode === 'mes' ? { ...rows[0], dealIds: rows[0].dealIds } : aggregate(rows, f.thresholds);
  if (u.mode === 'mes') sum.asesores = rows[0].asesores.filter((a) => a.billing || a.commission);
  // Curva: en "Mes" se muestra el año de ese mes como contexto, resaltando el mes elegido.
  const chartRows = u.mode === 'mes' ? scopeRowsFor(f, 'anio') : rows;
  S.ui.financeData = { f, rows, sum, chartRows };

  const [curY] = S.today.split('-').map(Number);
  const years = [];
  for (let y = curY + 1; y >= curY - 6; y--) years.push(y);
  const scopeName = u.mode === 'mes' ? `${MONTHS[u.month - 1]} ${u.year}` : u.mode === 'anio' ? `Año ${u.year}` : 'General (todo el tiempo)';
  const th = f.thresholds;

  return `
    <div class="page-head">
      <div><h1>Balance financiero</h1><p class="muted">${esc(scopeName)} · lo que realmente queda después de comisiones y gastos</p></div>
      <div class="toolbar">
        <div class="seg">
          ${[['mes', 'Mes'], ['anio', 'Año'], ['general', 'General']].map(([k, l]) => `<button class="seg-btn ${u.mode === k ? 'active' : ''}" data-action="finance-mode" data-mode="${k}">${l}</button>`).join('')}
        </div>
        ${u.mode === 'mes' ? `<select class="input input-sm" data-change="finance-month" title="Mes">${options(MONTHS.map((x, i) => ({ value: i + 1, label: x })), u.month)}</select>` : ''}
        ${u.mode !== 'general' ? `<select class="input input-sm" data-change="finance-year" title="Año">${options(years, u.year)}</select>` : ''}
      </div>
    </div>

    <section class="finance-cards">
      <div class="fin-card">
        <span class="stat-label">1 · Facturación</span>
        <strong class="stat-value">${money(sum.billing)}</strong>
        <small>${sum.wonCount ? `<button class="link-num" data-action="finance-drill">${sum.wonCount} negocio(s) ganado(s)</button>` : 'Sin negocios ganados'}</small>
      </div>
      <div class="fin-op">×</div>
      <div class="fin-card admin">
        <span class="stat-label">2 · Tu ganancia (${pct(f.adminRate)})</span>
        <strong class="stat-value">${money(sum.adminGross)}</strong>
        <small>${pct(f.adminRate)} de la facturación</small>
      </div>
      <div class="fin-op">−</div>
      <div class="fin-card asesor">
        <span class="stat-label">3 · Comisión asesores</span>
        <strong class="stat-value">${money(sum.asesoresCommission)}</strong>
        <small>Tasa de cada asesor × lo que facturó</small>
      </div>
      <div class="fin-op">−</div>
      <div class="fin-card expense">
        <span class="stat-label">4 · Gastos de operación</span>
        <strong class="stat-value">${money(sum.expensesTotal)}</strong>
        <small>${sum.expenses.length} gasto(s) registrado(s)</small>
      </div>
      <div class="fin-op">=</div>
      <div class="fin-card net${neg(sum.net)}">
        <span class="stat-label">5 · Te queda</span>
        <strong class="stat-value">${money(sum.net)}</strong>
        <small>Ganancia real</small>
      </div>
    </section>

    <section class="finance-grid">
      <div class="card chart-card">
        <div class="section-head"><h3>Curva de la operación <small class="muted">· ${u.mode === 'general' ? 'todos los meses' : `año ${u.year}`}</small></h3>
          <div class="chart-legend">${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div></div>
        <div class="line-chart" id="finance-chart"></div>
      </div>
      <div class="card profit-card level-${sum.level}">
        <h3>Rentabilidad · ${esc(scopeName)}</h3>
        <div class="profit-hero">
          <span class="dot big-dot ${LEVELS[sum.level].dot}"></span>
          <div><strong>${sum.margin === null ? '—' : pct(sum.margin)}</strong><span>${LEVELS[sum.level].label}</span></div>
        </div>
        <p class="muted">${sum.margin === null
    ? (sum.level === 'sin-datos' ? 'No hubo movimiento en este período.' : 'Hubo costos pero no hubo facturación.')
    : sum.margin >= 0
      ? `De cada $100 de tu ganancia (${pct(f.adminRate)}), te quedan <b>$${Math.round(sum.margin)}</b> después de comisiones y gastos.`
      : `Las comisiones y gastos superaron tu ganancia: por cada $100 que ganaste, perdiste <b>$${Math.abs(Math.round(sum.margin))}</b>.`}</p>
        <ul class="profit-scale">
          <li><span class="dot dot-verde"></span> Excelente: ${th.excelente}% o más</li>
          <li><span class="dot dot-amarillo"></span> Bueno: ${th.bueno}% a ${th.excelente}%</li>
          <li><span class="dot dot-rojo"></span> Muy malo: menos de ${th.bueno}%</li>
        </ul>
      </div>
    </section>

    ${u.mode !== 'mes' ? `
    <section class="card no-pad">
      <div class="card-head"><h3>Mes a mes · ${esc(scopeName)}</h3><small class="muted">Clic en un mes para ver su detalle</small></div>
      <div class="table-wrap table-scroll" data-scroll-key="finance-table"><table class="table compact finance-table">
        <thead><tr><th>Mes</th><th class="num">Facturación</th><th class="num">Tu ganancia</th><th class="num">Comisiones</th><th class="num">Gastos</th><th class="num">Te queda</th><th>Rentabilidad</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr class="clickable" data-action="finance-open-month" data-year="${r.year}" data-month="${r.month}">
          <td>${monthLabel(r)}</td><td class="num">${money(r.billing)}</td><td class="num">${money(r.adminGross)}</td>
          <td class="num">${money(r.asesoresCommission)}</td><td class="num">${money(r.expensesTotal)}</td>
          <td class="num${neg(r.net)}"><b>${money(r.net)}</b></td><td>${light(r)}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">Sin movimiento.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(sum.billing)}</td><td class="num">${money(sum.adminGross)}</td><td class="num">${money(sum.asesoresCommission)}</td>
          <td class="num">${money(sum.expensesTotal)}</td><td class="num${neg(sum.net)}">${money(sum.net)}</td><td>${light(sum)}</td></tr></tfoot>
      </table></div>
    </section>` : ''}

    <section class="finance-grid even">
      ${expensesCard(f, u, sum)}
      <div class="card">
        <h3>Comisiones de asesores <small class="muted">· ${esc(scopeName)}</small></h3>
        ${sum.asesores.length ? `<div class="table-wrap"><table class="table compact">
          <thead><tr><th>Asesor</th><th class="num">Facturó</th><th class="num">%</th><th class="num">A pagar</th></tr></thead>
          <tbody>${sum.asesores.map((a) => `<tr><td>${esc(a.name)}</td>
            <td class="num"><button class="link-num" data-action="finance-drill" data-user="${esc(a.userId)}">${money(a.billing)}</button></td>
            <td class="num">${pct(a.rate)}</td><td class="num"><b>${money(a.commission)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${money(sum.asesores.reduce((x, a) => x + a.billing, 0))}</td><td></td><td class="num">${money(sum.asesoresCommission)}</td></tr></tfoot>
        </table></div>` : emptyState('Ningún asesor facturó en este período.')}
      </div>
    </section>
    <p class="muted small-note">Tu porcentaje (${pct(f.adminRate)}) y el de cada asesor se cambian en <a href="#/usuarios">Usuarios</a>. La facturación cuenta los negocios en "Cierre ganado" según su fecha de cierre.</p>`;
}

function scopeRowsFor(f, mode) {
  const saved = ui().mode;
  ui().mode = mode;
  const r = scopeRows(f);
  ui().mode = saved;
  return r;
}

function expensesCard(f, u, sum) {
  if (u.mode !== 'mes') {
    const byCat = {};
    for (const e of sum.expenses) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount);
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    return `<div class="card">
      <h3>Gastos de operación por categoría</h3>
      ${cats.length ? `<table class="table compact"><tbody>${cats.map(([c, v]) => `<tr><td><span class="chip chip-sm">${esc(c)}</span></td><td class="num"><b>${money(v)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(sum.expensesTotal)}</td></tr></tfoot></table>` : '<p class="muted">Sin gastos registrados en este período.</p>'}
      <p class="muted small-note">Para agregar o corregir gastos, elige la vista <b>Mes</b>.</p>
    </div>`;
  }
  const m = S.ui.financeData.rows[0];
  const prev = u.month > 1 ? f.months[u.month - 2] : null;
  return `<div class="card expenses-card">
    <div class="section-head">
      <h3>Gastos de operación <small class="muted">(los llenas tú)</small></h3>
      ${prev && prev.expenses.length && !m.expenses.length ? `<button class="btn btn-sm" data-action="expense-copy">Copiar de ${MONTHS[prev.month - 1]}</button>` : ''}
    </div>
    <form class="expense-form" id="expense-form" autocomplete="off">
      <input class="input" id="exp-category" name="category" list="exp-categories" placeholder="Categoría: Marketing…" required aria-label="Categoría">
      <input class="input" id="exp-amount" name="amount" inputmode="numeric" placeholder="Valor: 1.500.000" required aria-label="Valor">
      <input class="input" id="exp-description" name="description" placeholder="Descripción (opcional)" maxlength="300" aria-label="Descripción">
      <button class="btn btn-primary" type="submit" title="Agregar gasto">${icon('plus')} Agregar gasto</button>
      <datalist id="exp-categories">${f.expenseCategories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </form>
    ${m.expenses.length ? `<div class="table-wrap"><table class="table compact">
      <tbody>${m.expenses.map((e) => `<tr>
        <td><span class="chip chip-sm">${esc(e.category)}</span></td><td>${esc(e.description || '—')}</td>
        <td class="num"><b>${money(e.amount)}</b></td>
        <td class="actions"><button class="icon-btn" data-action="expense-edit" data-id="${esc(e.id)}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn danger" data-action="expense-delete" data-id="${esc(e.id)}" title="Eliminar">${icon('trash')}</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total del mes</td><td class="num">${money(m.expensesTotal)}</td><td></td></tr></tfoot>
    </table></div>` : '<p class="muted">Aún no hay gastos registrados para este mes.</p>'}
  </div>`;
}

// ---------------------------------------------------------------- gráfico de líneas
// Colores validados (contraste, daltonismo y separación): facturación, tu ganancia, te queda.
const SERIES = [
  { key: 'billing', label: 'Facturación', color: '#5b43c0' },
  { key: 'adminGross', label: 'Tu ganancia', color: '#1a8fd0' },
  { key: 'net', label: 'Te queda', color: '#eb6834' },
];

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

function drawChart(el, rows, highlight) {
  if (!rows.length) { el.innerHTML = emptyState('Sin datos para graficar.'); return; }
  const W = Math.max(320, el.clientWidth);
  const H = 250;
  const pad = { l: 64, r: 16, t: 12, b: 28 };
  const values = rows.flatMap((r) => SERIES.map((s) => r[s.key]));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (i) => pad.l + (rows.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (rows.length - 1));
  const y = (v) => pad.t + ((y1 - v) * (H - pad.t - pad.b)) / (y1 - y0 || 1);
  const every = Math.ceil(rows.length / Math.floor((W - pad.l) / 56));
  const showMarkers = rows.length <= 18;

  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'zero' : 'grid'}"/>
    <text x="${pad.l - 8}" y="${y(t) + 4}" class="ytick">${esc(compactMoney(t))}</text>`).join('');
  const xlabels = rows.map((r, i) => (i % every === 0 || i === highlight ? `<text x="${x(i)}" y="${H - 8}" class="xtick${i === highlight ? ' hl' : ''}">${esc(monthLabel(r, true))}</text>` : '')).join('');
  const band = highlight >= 0 ? `<rect x="${x(highlight) - 14}" y="${pad.t}" width="28" height="${H - pad.t - pad.b}" class="hl-band"/>` : '';
  const lines = SERIES.map((s) => {
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join('');
    const dots = showMarkers || rows.length === 1 ? rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r[s.key])}" r="${i === highlight ? 5 : 3.5}" fill="${s.color}" class="pt"/>`).join('') : '';
    return `<path d="${d}" stroke="${s.color}" class="series"/>${dots}`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Curva mensual de facturación, ganancia y lo que queda">
    ${band}${grid}${xlabels}${lines}
    <line class="crosshair" y1="${pad.t}" y2="${H - pad.b}" x1="${pad.l}" x2="${pad.l}" visibility="hidden"/>
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/>
  </svg><div class="chart-tip" hidden></div>`;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('.chart-tip');
  const cross = el.querySelector('.crosshair');
  const th = S.ui.financeData.f.thresholds;
  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) * W) / rect.width;
    const i = rows.length === 1 ? 0 : Math.max(0, Math.min(rows.length - 1, Math.round(((px - pad.l) * (rows.length - 1)) / (W - pad.l - pad.r))));
    const r = rows[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<strong>${esc(monthLabel(r))}</strong>
      ${SERIES.map((s) => `<div><i style="background:${s.color}"></i>${s.label}<b>${money(r[s.key])}</b></div>`).join('')}
      <div class="tip-profit">${light(profitability(r, th))}</div>`;
    tip.hidden = false;
    const left = (x(i) / W) * rect.width;
    tip.style.left = `${Math.min(rect.width - 200, Math.max(0, left + 12))}px`;
  };
  const hit = el.querySelector('.hit');
  hit.addEventListener('mousemove', onMove);
  hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

// "1.500.000", "$ 1,500,000" o "1500000" → 1500000
const parseAmount = (v) => Number(String(v).replace(/[^\d]/g, ''));

export function mount(root) {
  const d = S.ui.financeData;
  const u = ui();
  const chart = root.querySelector('#finance-chart');
  if (chart && d) {
    const hl = u.mode === 'mes' ? d.chartRows.findIndex((r) => r.month === u.month) : -1;
    drawChart(chart, d.chartRows, hl);
  }
  const form = root.querySelector('#expense-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = parseAmount(fd.get('amount'));
    const category = String(fd.get('category')).trim();
    if (!category) { await alertDialog('Escribe o elige una categoría (ej.: Marketing, Planes móviles).'); return; }
    if (!amount) { await alertDialog('Escribe el valor del gasto.'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('POST', '/api/admin/expenses', { year: u.year, month: u.month, category, description: fd.get('description'), amount });
      toast('Gasto registrado');
      await window.crm.render();
      document.getElementById('exp-category')?.focus();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

// Redibuja el gráfico al cambiar el tamaño de la ventana.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const el = document.getElementById('finance-chart');
    if (el && S.ui.financeData) mount(el.closest('main') || document);
  }, 200);
});

const findExpense = (idExp) => S.ui.financeData.f.months.flatMap((x) => x.expenses).find((e) => e.id === idExp);

export const actions = {
  'finance-mode': (el) => { ui().mode = el.dataset.mode; window.crm.render(); },
  'finance-open-month': (el) => {
    Object.assign(ui(), { mode: 'mes', year: Number(el.dataset.year), month: Number(el.dataset.month) });
    window.crm.render();
  },
  'finance-drill': (el) => {
    const { sum } = S.ui.financeData;
    const a = el.dataset.user && sum.asesores.find((x) => x.userId === el.dataset.user);
    drillDeals(a ? `Negocios ganados de ${a.name}` : 'Negocios ganados', a ? a.dealIds : sum.dealIds);
  },
  'expense-edit': (el) => {
    const e = findExpense(el.dataset.id);
    if (!e) return;
    formModal({
      title: 'Editar gasto',
      size: 'sm',
      fields: [
        { name: 'category', label: 'Categoría', value: e.category, required: true, full: true, list: 'exp-categories' },
        { name: 'description', label: 'Descripción', value: e.description, full: true },
        { name: 'amount', label: 'Valor (COP)', value: Number(e.amount).toLocaleString('es-CO'), required: true, full: true },
      ],
      onSubmit: async (v) => {
        const amount = parseAmount(v.amount);
        if (!amount) throw new Error('Escribe el valor del gasto.');
        await api('PATCH', `/api/admin/expenses/${e.id}`, { category: v.category, description: v.description, amount });
        toast('Gasto actualizado');
        await window.crm.render();
      },
    });
  },
  'expense-delete': async (el) => {
    const e = findExpense(el.dataset.id);
    if (!e) return;
    const ok = await confirmDialog(`¿Eliminar el gasto "${e.category}${e.description ? ` · ${e.description}` : ''}" por ${money(e.amount)}?`, { title: 'Eliminar gasto', okText: 'Eliminar', danger: true });
    if (!ok) return;
    await api('DELETE', `/api/admin/expenses/${e.id}`);
    toast('Gasto eliminado');
    await window.crm.render();
  },
  'expense-copy': async () => {
    const u = ui();
    const r = await api('POST', '/api/admin/expenses/copy', { fromYear: u.year, fromMonth: u.month - 1, toYear: u.year, toMonth: u.month });
    toast(`${r.copied} gasto(s) copiados. Ajusta los valores si cambiaron.`);
    await window.crm.render();
  },
};

export const changes = {
  'finance-month': (el) => { ui().month = Number(el.value); window.crm.render(); },
  'finance-year': (el) => { ui().year = Number(el.value); window.crm.render(); },
};
