import {
  S, api, esc, money, pct, options, MONTHS,
} from '../core.js';
import { emptyState } from '../ui.js';
import { drillDeals } from './reports.js';

export const id = 'finanzas';
export const title = 'Balance financiero';
export const navIcon = 'finanzas';
export const adminOnly = true;

// Mes/año elegidos (por defecto, el del período del Panel o el mes actual).
const ui = () => {
  if (!S.ui.finance) {
    const [y, m] = S.today.split('-').map(Number);
    const p = S.period;
    S.ui.finance = p?.type === 'month' ? { year: p.year, month: p.month } : { year: p?.year || y, month: m };
  }
  return S.ui.finance;
};

const neg = (n) => (n < 0 ? ' negative' : '');

export async function render() {
  const u = ui();
  const f = await api('GET', `/api/admin/finance?year=${u.year}`);
  S.ui.financeData = f;
  const m = f.months[u.month - 1];
  const [curY] = S.today.split('-').map(Number);
  const years = [];
  for (let y = curY + 1; y >= curY - 6; y--) years.push(y);
  const monthName = `${MONTHS[u.month - 1]} ${u.year}`;
  const asesores = m.asesores.filter((a) => a.billing > 0 || a.commission > 0);

  return `
    <div class="page-head">
      <div><h1>Balance financiero</h1><p class="muted">Tu ganancia como administrador y lo que queda después de pagar las comisiones de los asesores</p></div>
      <div class="toolbar">
        <select class="input input-sm" data-change="finance-month" title="Mes">${options(MONTHS.map((x, i) => ({ value: i + 1, label: x })), u.month)}</select>
        <select class="input input-sm" data-change="finance-year" title="Año">${options(years, u.year)}</select>
      </div>
    </div>

    <section class="finance-cards">
      <div class="fin-card">
        <span class="stat-label">1 · Facturación total del mes</span>
        <strong class="stat-value">${money(m.billing)}</strong>
        <small>${m.wonCount ? `<button class="link-num" data-action="finance-drill" data-month="${u.month}">${m.wonCount} negocio(s) ganado(s)</button>` : 'Sin negocios ganados'} · ${esc(monthName)}</small>
      </div>
      <div class="fin-op">×</div>
      <div class="fin-card admin">
        <span class="stat-label">2 · Tu ganancia (${pct(f.adminRate)})</span>
        <strong class="stat-value">${money(m.adminGross)}</strong>
        <small>${pct(f.adminRate)} de la facturación del mes</small>
      </div>
      <div class="fin-op">−</div>
      <div class="fin-card asesor">
        <span class="stat-label">3 · Comisión a pagar a asesores</span>
        <strong class="stat-value">${money(m.asesoresCommission)}</strong>
        <small>Tasa de cada asesor × lo que él facturó</small>
      </div>
      <div class="fin-op">=</div>
      <div class="fin-card net${neg(m.net)}">
        <span class="stat-label">4 · Te queda (ganancia neta)</span>
        <strong class="stat-value">${money(m.net)}</strong>
        <small>${m.net < 0 ? 'Las comisiones superan tu ganancia este mes' : 'Después de pagar comisiones'}</small>
      </div>
    </section>

    <section class="card">
      <h3>Comisiones de asesores · ${esc(monthName)}</h3>
      ${asesores.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Asesor</th><th class="num">Facturación del asesor</th><th class="num">% comisión</th><th class="num">Comisión a pagar</th></tr></thead>
        <tbody>${asesores.map((a) => `<tr>
          <td>${esc(a.name)}</td>
          <td class="num"><button class="link-num" data-action="finance-drill" data-month="${u.month}" data-user="${esc(a.userId)}">${money(a.billing)}</button></td>
          <td class="num">${pct(a.rate)}</td><td class="num"><b>${money(a.commission)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(asesores.reduce((x, a) => x + a.billing, 0))}</td><td></td><td class="num">${money(m.asesoresCommission)}</td></tr></tfoot>
      </table></div>` : emptyState('Ningún asesor facturó en este mes.')}
    </section>

    <section class="card no-pad">
      <div class="card-head"><h3>Balance mes a mes · ${u.year}</h3><small class="muted">Haz clic en un mes para ver su detalle</small></div>
      <div class="table-wrap"><table class="table finance-table">
        <thead><tr><th>Mes</th><th class="num">Facturación total</th><th class="num">Tu ganancia (${pct(f.adminRate)})</th><th class="num">Comisión asesores</th><th class="num">Te queda</th></tr></thead>
        <tbody>${f.months.map((x) => `<tr class="clickable${x.month === u.month ? ' selected' : ''}" data-action="finance-select" data-month="${x.month}">
          <td>${MONTHS[x.month - 1]}</td><td class="num">${money(x.billing)}</td><td class="num">${money(x.adminGross)}</td>
          <td class="num">${money(x.asesoresCommission)}</td><td class="num${neg(x.net)}"><b>${money(x.net)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total ${u.year}</td><td class="num">${money(f.totals.billing)}</td><td class="num">${money(f.totals.adminGross)}</td>
          <td class="num">${money(f.totals.asesoresCommission)}</td><td class="num${neg(f.totals.net)}">${money(f.totals.net)}</td></tr></tfoot>
      </table></div>
    </section>
    <p class="muted small-note">Tu porcentaje (${pct(f.adminRate)}) y el de cada asesor se cambian en <a href="#/usuarios">Usuarios</a>. La facturación cuenta los negocios en "Cierre ganado" según su fecha de cierre.</p>`;
}

export const actions = {
  'finance-select': (el) => { ui().month = Number(el.dataset.month); window.crm.render(); },
  'finance-drill': (el) => {
    const m = S.ui.financeData.months[Number(el.dataset.month) - 1];
    const a = el.dataset.user && m.asesores.find((x) => x.userId === el.dataset.user);
    drillDeals(a ? `Negocios ganados de ${a.name} · ${MONTHS[m.month - 1]}` : `Negocios ganados · ${MONTHS[m.month - 1]}`, a ? a.dealIds : m.dealIds);
  },
};

export const changes = {
  'finance-month': (el) => { ui().month = Number(el.value); window.crm.render(); },
  'finance-year': (el) => { ui().year = Number(el.value); window.crm.render(); },
};
