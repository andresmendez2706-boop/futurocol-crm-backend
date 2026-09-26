import {
  S, api, esc, icon, money, pct, options, MONTHS,
} from '../core.js';
import {
  emptyState, formModal, confirmDialog, alertDialog, toast,
} from '../ui.js';
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
  // Mes anterior (para copiar gastos fijos); en enero solo se ofrece dentro del mismo año cargado.
  const prevMonth = u.month === 1 ? null : u.month - 1;
  const prev = prevMonth ? f.months[prevMonth - 1] : null;

  return `
    <div class="page-head">
      <div><h1>Balance financiero</h1><p class="muted">Tu ganancia como administrador y lo que realmente queda después de comisiones y gastos de operación</p></div>
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
      <div class="fin-op">−</div>
      <div class="fin-card expense">
        <span class="stat-label">4 · Gastos de operación</span>
        <strong class="stat-value">${money(m.expensesTotal)}</strong>
        <small>${m.expenses.length ? `${m.expenses.length} gasto(s) registrado(s)` : 'Regístralos abajo ↓'}</small>
      </div>
      <div class="fin-op">=</div>
      <div class="fin-card net${neg(m.net)}">
        <span class="stat-label">5 · Te queda (ganancia real)</span>
        <strong class="stat-value">${money(m.net)}</strong>
        <small>${m.net < 0 ? 'Este mes los costos superan tu ganancia' : 'Después de comisiones y gastos'}</small>
      </div>
    </section>

    <section class="card expenses-card">
      <div class="section-head">
        <h3>Gastos de operación · ${esc(monthName)} <small class="muted">(los llenas tú)</small></h3>
        ${prev && prev.expenses.length && !m.expenses.length ? `<button class="btn btn-sm" data-action="expense-copy">Copiar gastos de ${MONTHS[prevMonth - 1]} (${money(prev.expensesTotal)})</button>` : ''}
      </div>
      <form class="expense-form" id="expense-form" autocomplete="off">
        <label class="field"><span>Categoría</span>
          <input class="input" id="exp-category" name="category" list="exp-categories" placeholder="Ej: Marketing" required></label>
        <label class="field"><span>Descripción (opcional)</span>
          <input class="input" id="exp-description" name="description" placeholder="Ej: Publicidad en Meta" maxlength="300"></label>
        <label class="field"><span>Valor (COP)</span>
          <input class="input" id="exp-amount" name="amount" inputmode="numeric" placeholder="Ej: 1.500.000" required></label>
        <button class="btn btn-primary" type="submit">${icon('plus')} Agregar gasto</button>
        <datalist id="exp-categories">${f.expenseCategories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </form>
      ${m.expenses.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Categoría</th><th>Descripción</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${m.expenses.map((e) => `<tr>
          <td><span class="chip chip-sm">${esc(e.category)}</span></td><td>${esc(e.description || '—')}</td>
          <td class="num"><b>${money(e.amount)}</b></td>
          <td class="actions"><button class="icon-btn" data-action="expense-edit" data-id="${esc(e.id)}" title="Editar">${icon('edit')}</button>
            <button class="icon-btn danger" data-action="expense-delete" data-id="${esc(e.id)}" title="Eliminar">${icon('trash')}</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total gastos del mes</td><td class="num">${money(m.expensesTotal)}</td><td></td></tr></tfoot>
      </table></div>` : '<p class="muted">Aún no hay gastos registrados para este mes.</p>'}
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
        <thead><tr><th>Mes</th><th class="num">Facturación total</th><th class="num">Tu ganancia (${pct(f.adminRate)})</th><th class="num">Comisión asesores</th><th class="num">Gastos operación</th><th class="num">Te queda</th></tr></thead>
        <tbody>${f.months.map((x) => `<tr class="clickable${x.month === u.month ? ' selected' : ''}" data-action="finance-select" data-month="${x.month}">
          <td>${MONTHS[x.month - 1]}</td><td class="num">${money(x.billing)}</td><td class="num">${money(x.adminGross)}</td>
          <td class="num">${money(x.asesoresCommission)}</td><td class="num">${money(x.expensesTotal)}</td><td class="num${neg(x.net)}"><b>${money(x.net)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total ${u.year}</td><td class="num">${money(f.totals.billing)}</td><td class="num">${money(f.totals.adminGross)}</td>
          <td class="num">${money(f.totals.asesoresCommission)}</td><td class="num">${money(f.totals.expensesTotal)}</td><td class="num${neg(f.totals.net)}">${money(f.totals.net)}</td></tr></tfoot>
      </table></div>
    </section>
    <p class="muted small-note">Tu porcentaje (${pct(f.adminRate)}) y el de cada asesor se cambian en <a href="#/usuarios">Usuarios</a>. La facturación cuenta los negocios en "Cierre ganado" según su fecha de cierre.</p>`;
}

// "1.500.000", "$ 1,500,000" o "1500000" → 1500000
const parseAmount = (v) => Number(String(v).replace(/[^\d]/g, ''));

export function mount(root) {
  const form = root.querySelector('#expense-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = parseAmount(fd.get('amount'));
    const category = String(fd.get('category')).trim();
    if (!category) { await alertDialog('Escribe o elige una categoría (ej.: Marketing, Planes móviles).'); return; }
    if (!amount) { await alertDialog('Escribe el valor del gasto.'); return; }
    const u = ui();
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

const findExpense = (idExp) => S.ui.financeData.months.flatMap((x) => x.expenses).find((e) => e.id === idExp);

export const actions = {
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
