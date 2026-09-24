import {
  S, api, esc, isAdmin, options, periodQuery, periodLabel, pct,
} from '../core.js';
import { periodPicker, emptyState } from '../ui.js';
import { drillDeals } from './reports.js';

export const id = 'embudo';
export const title = 'Embudo';
export const navIcon = 'embudo';

const ui = () => (S.ui.funnel ||= { userId: '' });

export async function render() {
  const u = ui();
  const q = new URLSearchParams(periodQuery());
  if (u.userId) q.set('userId', u.userId);
  const f = await api('GET', `/api/stats/funnel?${q}`);
  S.ui.funnel.data = f;
  const max = Math.max(1, f.steps[0]?.count || 1);
  return `
    <div class="page-head">
      <div><h1>Embudo de conversión</h1><p class="muted">Negocios creados en ${esc(periodLabel().toLowerCase())} · ${isAdmin() ? (u.userId ? 'por asesor' : 'vista general') : 'mis negocios'}</p></div>
      <div class="toolbar">
        ${isAdmin() ? `<select class="input input-sm" data-change="funnel-user">${options(S.users.map((x) => ({ value: x.id, label: x.name })), u.userId, { empty: 'General (todos)' })}</select>` : ''}
        ${periodPicker()}
      </div>
    </div>
    <div class="card">
      ${f.total ? `<div class="funnel">${f.steps.map((s, i) => `
        <div class="funnel-row clickable" data-action="funnel-drill" data-index="${i}">
          <span class="funnel-label">${esc(s.label)}</span>
          <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max(4, (s.count / max) * 100)}%"><b>${s.count}</b></div></div>
          <span class="funnel-conv">${i === 0 ? '100%' : `${pct(s.conversionFromPrev)} <small>vs. anterior</small>`}<small class="block">${pct(s.conversionFromStart)} del total</small></span>
        </div>`).join('')}</div>
        <div class="funnel-foot">
          <button class="chip clickable" data-action="funnel-drill" data-kind="lost">Perdidos: <b>${f.lost.length}</b></button>
          <button class="chip clickable" data-action="funnel-drill" data-kind="postponed">Aplazados: <b>${f.postponed.length}</b></button>
          <span class="chip">Total: <b>${f.total}</b></span>
        </div>` : emptyState('No hay negocios en este período.')}
    </div>`;
}

export const actions = {
  'funnel-drill': (el) => {
    const f = S.ui.funnel.data;
    if (el.dataset.kind === 'lost') return drillDeals('Negocios perdidos', f.lost);
    if (el.dataset.kind === 'postponed') return drillDeals('Negocios aplazados', f.postponed);
    const step = f.steps[Number(el.dataset.index)];
    return drillDeals(`Alcanzaron "${step.label}"`, step.ids);
  },
};

export const changes = {
  'funnel-user': (el) => { ui().userId = el.value; window.crm.render(); },
};
