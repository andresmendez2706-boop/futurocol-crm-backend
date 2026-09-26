import {
  S, esc, money, compactMoney, pct, isAdmin, cachedDashboard, periodLabel, fmtDateTime, stageLabel,
  MONTHS_SHORT, ACTIVITY_LABELS,
} from '../core.js';
import { periodPicker, emptyState } from '../ui.js';

export const id = 'panel';
export const title = 'Panel';
export const navIcon = 'panel';

const card = (label, value, { sub = '', tone = '', action = '' } = {}) => `
  <div class="stat-card ${tone}" ${action}>
    <span class="stat-label">${esc(label)}</span>
    <strong class="stat-value">${value}</strong>
    ${sub ? `<small class="stat-sub">${sub}</small>` : ''}
  </div>`;

function bars(items, { valueKey = 'count', format = (v) => v, sub } = {}) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar">
      <span class="hbar-label">${esc(i.label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(i[valueKey] / max) * 100}%"></div></div>
      <span class="hbar-value">${format(i[valueKey])}${sub ? `<small>${sub(i)}</small>` : ''}</span>
    </div>`).join('')}</div>`;
}

function billingChart(data) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return `<div class="vbars">${data.map((d) => {
    const [y, m] = d.month.split('-').map(Number);
    return `<div class="vbar" title="${esc(money(d.value))}">
      <span class="vbar-value">${d.value ? compactMoney(d.value) : ''}</span>
      <div class="vbar-track"><div class="vbar-fill" style="height:${(d.value / max) * 100}%"></div></div>
      <span class="vbar-label">${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}</span>
    </div>`;
  }).join('')}</div>`;
}

function recentItem(r) {
  const what = r.kind === 'activity'
    ? `<b>${esc(ACTIVITY_LABELS[r.type] || r.type)}</b> con <a href="#" data-action="open-contact" data-id="${esc(r.contactId)}">${esc(r.label)}</a>: ${esc(r.text)}`
    : `<a href="#" data-action="open-deal" data-id="${esc(r.dealId)}">${esc(r.label)}</a> ${r.from ? `pasó de <b>${esc(stageLabel(r.from))}</b> a` : 'creado en'} <b>${esc(stageLabel(r.stage))}</b>`;
  return `<li><div>${what}</div><small>${esc(r.by || '')} · ${fmtDateTime(r.at)}</small></li>`;
}

export async function render() {
  const d = await cachedDashboard();
  const c = d.cards;
  const admin = isAdmin();
  const pl = periodLabel();
  return `
    <div class="page-head">
      <div><h1>Panel</h1><p class="muted">Hola, ${esc(S.me.name.split(' ')[0])}. Resumen de ${esc(pl.toLowerCase())}.</p></div>
      <div class="toolbar">${periodPicker()}</div>
    </div>

    <section class="stats-grid">
      ${card('Contactos del período', c.contacts.toLocaleString('es-CO'), { sub: `leads creados · ${esc(pl)}${S.period.type !== 'all' ? ` · ${c.contactsTotal.toLocaleString('es-CO')} en total` : ''}`, action: 'data-action="go-contacts"' })}
      ${card('Negocios abiertos', c.openDeals.toLocaleString('es-CO'), { action: 'data-action="go" data-to="negocios"' })}
      ${card('Valor en trámite', compactMoney(c.openValue), { sub: money(c.openValue) })}
      ${admin ? card('Pipeline ponderado', compactMoney(c.weightedPipeline), { sub: 'valor × probabilidad' }) : ''}
      ${card('Ganados del período', c.wonCount.toLocaleString('es-CO'), { sub: esc(pl), tone: 'tone-green' })}
      ${card('Facturación del período', compactMoney(c.billing), { sub: money(c.billing), tone: 'tone-green' })}
    </section>

    <section class="commission-grid">
      ${admin ? `
        <div class="commission-card">
          <span class="stat-label">Comisión de asesores</span>
          <strong class="stat-value">${money(c.asesoresCommission)}</strong>
          <small>Suma de la tasa individual de cada asesor × lo que él mismo cerró · ${esc(pl)}</small>
        </div>
        <div class="commission-card admin">
          <span class="stat-label">Comisión de admin (gerencia)</span>
          <strong class="stat-value">${money(c.adminCommission)}</strong>
          <small>${pct(c.adminRate)} × facturación total de la academia (${money(c.academyBilling)}) · ${esc(pl)}</small>
        </div>` : `
        <div class="commission-card">
          <span class="stat-label">Mi comisión</span>
          <strong class="stat-value">${money(c.myCommission)}</strong>
          <small>${pct(c.myRate)} × mi facturación (${money(c.billing)}) · ${esc(pl)}</small>
        </div>`}
    </section>

    <section class="panel-grid">
      <div class="card">
        <h3>Facturación de los últimos 6 meses</h3>
        ${billingChart(d.billing6)}
      </div>
      <div class="card">
        <h3>Leads por etapa <small class="muted">· creados en ${esc(pl.toLowerCase())}</small></h3>
        ${bars(d.leadsByStage)}
      </div>
      <div class="card">
        <h3>Negocios por etapa</h3>
        ${bars(d.dealsByStage, { sub: (i) => (i.value ? ` · ${compactMoney(i.value)}` : '') })}
      </div>
      <div class="card">
        <h3>Actividad reciente</h3>
        ${d.recent.length ? `<ul class="recent">${d.recent.map(recentItem).join('')}</ul>` : emptyState('Aún no hay actividad.')}
      </div>
    </section>

    ${admin && d.perAsesor ? `
    <section class="card">
      <h3>Gestión por asesor <small class="muted">· ${esc(pl)}</small></h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Asesor</th><th class="num">Leads</th><th class="num">Negocios</th><th class="num">Abiertos</th><th class="num">Ganados</th><th class="num">Facturación</th><th class="num">Tasa</th><th class="num">Comisión</th></tr></thead>
        <tbody>${d.perAsesor.length ? d.perAsesor.map((a) => `<tr>
          <td>${esc(a.name)}</td><td class="num">${a.leads}</td><td class="num">${a.deals}</td><td class="num">${a.openDeals}</td>
          <td class="num">${a.won}</td><td class="num">${money(a.billing)}</td><td class="num">${pct(a.rate)}</td><td class="num"><b>${money(a.commission)}</b></td>
        </tr>`).join('') : '<tr><td colspan="8" class="muted">No hay asesores registrados.</td></tr>'}</tbody>
      </table></div>
    </section>` : ''}`;
}

export const actions = {
  go: (el) => { location.hash = `#/${el.dataset.to}`; },
  // Abre Contactos ya filtrado por el mismo mes/año del Panel.
  'go-contacts': () => {
    const p = S.period;
    S.ui.contacts = {
      ...(S.ui.contacts || { q: '', layout: S.me.prefs?.contactsLayout || 'lista' }),
      year: p.type === 'all' ? '' : String(p.year),
      month: p.type === 'month' ? String(p.month) : '',
    };
    location.hash = '#/contactos';
  },
};
