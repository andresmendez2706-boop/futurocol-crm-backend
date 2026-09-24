import {
  S, api, esc, money, compactMoney, pct, periodQuery, periodLabel, contactById, dealById, taskById, userName,
  stageLabel, fmtDate, companyById, TASK_TYPE_LABELS, lightDot,
} from '../core.js';
import { openModal, periodPicker, emptyState } from '../ui.js';

export const id = 'reportes';
export const title = 'Reportes';
export const navIcon = 'reportes';
export const adminOnly = true;

// ---------------------------------------------------------------- detalle (drill-down)
export function drillDeals(title, ids) {
  const list = ids.map(dealById).filter(Boolean);
  const total = list.reduce((a, d) => a + Number(d.value || 0), 0);
  openModal({
    title: `${title} (${list.length})`,
    size: 'xl',
    body: list.length ? `<p class="muted">Valor total: <b>${money(total)}</b></p><div class="table-wrap"><table class="table compact">
      <thead><tr><th>Negocio</th><th>Contacto</th><th>Etapa</th><th class="num">Valor</th><th>Responsable</th><th>Cierre</th><th>Motivo pérdida</th></tr></thead>
      <tbody>${list.map((d) => `<tr class="clickable" data-action="open-deal" data-id="${esc(d.id)}"><td>${esc(d.title)}</td>
        <td>${esc(contactById(d.contactId)?.name || '—')}</td><td>${esc(stageLabel(d.stage))}</td><td class="num">${money(d.value)}</td>
        <td>${esc(userName(d.assignedTo))}</td><td>${fmtDate(d.closeDate)}</td><td>${esc(d.lossReason || '')}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Sin registros.'),
  });
}

export function drillContacts(title, ids) {
  const list = ids.map(contactById).filter(Boolean);
  openModal({
    title: `${title} (${list.length})`,
    size: 'xl',
    body: list.length ? `<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Contacto</th><th>Teléfono</th><th>Correo</th><th>Empresa</th><th>Programa</th><th>Responsable</th><th>Creado</th></tr></thead>
      <tbody>${list.map((c) => `<tr class="clickable" data-action="open-contact" data-id="${esc(c.id)}"><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td>
        <td>${esc(c.email || '')}</td><td>${esc(companyById(c.companyId)?.name || '')}</td><td>${esc(c.program || '')}</td>
        <td>${esc(userName(c.assignedTo))}</td><td>${fmtDate(c.createdAt)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Sin registros.'),
  });
}

export function drillTasks(title, ids) {
  const list = ids.map(taskById).filter(Boolean);
  openModal({
    title: `${title} (${list.length})`,
    size: 'xl',
    body: list.length ? `<div class="table-wrap"><table class="table compact">
      <thead><tr><th></th><th>Tarea</th><th>Tipo</th><th>Contacto</th><th>Vence</th><th>Responsable</th></tr></thead>
      <tbody>${list.map((t) => `<tr class="clickable" data-action="open-task" data-id="${esc(t.id)}"><td>${lightDot(t)}</td><td>${esc(t.title)}</td>
        <td>${esc(TASK_TYPE_LABELS[t.type] || t.type)}</td><td>${esc(contactById(t.contactId)?.name || '—')}</td><td>${fmtDate(t.dueDate)}</td>
        <td>${esc(userName(t.assignedTo))}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Sin registros.'),
  });
}

// ---------------------------------------------------------------- vista
const n = (value, kind, key, label, extra = '') => `<button class="link-num" data-action="report-drill" data-kind="${kind}" data-key="${esc(key)}" data-label="${esc(label)}"${extra}>${value}</button>`;

export async function render() {
  const r = await api('GET', `/api/admin/reports?${periodQuery()}`);
  S.ui.report = r;
  const pl = periodLabel();
  const reasons = Object.entries(r.lost.reasons).sort((a, b) => b[1].length - a[1].length);
  const programs = Object.entries(r.byProgram).sort((a, b) => b[1].length - a[1].length);
  return `
    <div class="page-head">
      <div><h1>Reportes</h1><p class="muted">${esc(pl)} · haz clic en cualquier número para ver el detalle</p></div>
      <div class="toolbar">${periodPicker()}</div>
    </div>

    <section class="stats-grid">
      <div class="stat-card tone-green"><span class="stat-label">Negocios ganados</span><strong class="stat-value">${n(r.won.count, 'won', '', 'Negocios ganados')}</strong><small class="stat-sub">${money(r.won.value)}</small></div>
      <div class="stat-card tone-red"><span class="stat-label">Negocios perdidos</span><strong class="stat-value">${n(r.lost.count, 'lost', '', 'Negocios perdidos')}</strong><small class="stat-sub">${money(r.lost.value)}</small></div>
      <div class="stat-card"><span class="stat-label">Tasa de cierre</span><strong class="stat-value">${pct(r.winRate)}</strong><small class="stat-sub">ganados / (ganados + perdidos)</small></div>
      <div class="stat-card"><span class="stat-label">Conversión de leads</span><strong class="stat-value">${n(pct(r.leadConversion.rate), 'converted', '', 'Leads convertidos')}</strong>
        <small class="stat-sub">${n(r.leadConversion.converted.length, 'converted', '', 'Leads convertidos')} de ${n(r.leadConversion.leads.length, 'leads', '', 'Leads del período')} leads</small></div>
      <div class="stat-card"><span class="stat-label">Ticket promedio</span><strong class="stat-value">${compactMoney(r.avgTicket)}</strong><small class="stat-sub">${money(r.avgTicket)}</small></div>
      <div class="stat-card tone-red"><span class="stat-label">Tareas vencidas</span><strong class="stat-value">${n(r.overdueTasks.length, 'overdue', '', 'Tareas vencidas')}</strong><small class="stat-sub">estado actual</small></div>
    </section>

    <section class="commission-grid">
      <div class="card">
        <h3>Comisión de asesores <small class="muted">· ${esc(pl)}</small></h3>
        <div class="table-wrap"><table class="table compact">
          <thead><tr><th>Asesor</th><th class="num">Tasa</th><th class="num">Facturación propia</th><th class="num">Comisión</th></tr></thead>
          <tbody>${r.commissions.asesores.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${pct(a.rate)}</td><td class="num">${money(a.billing)}</td><td class="num"><b>${money(a.commission)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin asesores</td></tr>'}</tbody>
          <tfoot><tr><td colspan="3">Total asesores</td><td class="num"><b>${money(r.commissions.asesoresTotal)}</b></td></tr></tfoot>
        </table></div>
      </div>
      <div class="card commission-admin-card">
        <h3>Comisión de admin (gerencia) <small class="muted">· ${esc(pl)}</small></h3>
        ${r.commissions.admins.map((a) => `<div class="admin-comm">
          <strong>${esc(a.name)}</strong>
          <span class="big-value">${money(a.commission)}</span>
          <small>${pct(a.rate)} × facturación total de la academia (${money(a.baseBilling)})</small>
          ${a.monthly.length > 1 ? `<table class="table compact"><tbody>${a.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td class="num">${money(m.billing)}</td><td class="num">${money(m.commission)}</td></tr>`).join('')}</tbody></table>` : ''}
        </div>`).join('')}
      </div>
    </section>

    <section class="panel-grid">
      <div class="card">
        <h3>Motivos de pérdida</h3>
        ${reasons.length ? `<table class="table compact"><tbody>${reasons.map(([reason, ids]) => `<tr><td>${esc(reason)}</td><td class="num">${n(ids.length, 'reason', reason, `Perdidos: ${reason}`)}</td></tr>`).join('')}</tbody></table>` : emptyState('Sin negocios perdidos en el período.')}
      </div>
      <div class="card">
        <h3>Leads por programa</h3>
        ${programs.length ? `<table class="table compact"><tbody>${programs.map(([p, ids]) => `<tr><td>${esc(p)}</td><td class="num">${n(ids.length, 'program', p, `Leads: ${p}`)}</td></tr>`).join('')}</tbody></table>` : emptyState('Sin leads en el período.')}
      </div>
    </section>

    <section class="card">
      <h3>Negocios por asesor</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Usuario</th><th class="num">Leads</th><th class="num">Negocios creados</th><th class="num">Ganados</th><th class="num">Perdidos</th><th class="num">Facturación</th></tr></thead>
        <tbody>${r.byAsesor.map((a, i) => `<tr><td>${esc(a.name)} ${a.role === 'admin' ? '<span class="chip chip-sm">admin</span>' : ''}</td>
          <td class="num">${n(a.leads.length, 'asesor', `${i}:leads`, `Leads de ${a.name}`)}</td>
          <td class="num">${n(a.deals.length, 'asesor', `${i}:deals`, `Negocios de ${a.name}`)}</td>
          <td class="num">${n(a.won.length, 'asesor', `${i}:won`, `Ganados de ${a.name}`)}</td>
          <td class="num">${n(a.lost.length, 'asesor', `${i}:lost`, `Perdidos de ${a.name}`)}</td>
          <td class="num">${money(a.billing)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
}

export const actions = {
  'report-drill': (el) => {
    const r = S.ui.report;
    const { kind, key, label } = el.dataset;
    if (kind === 'won') return drillDeals(label, r.won.ids);
    if (kind === 'lost') return drillDeals(label, r.lost.ids);
    if (kind === 'reason') return drillDeals(label, r.lost.reasons[key] || []);
    if (kind === 'converted') return drillContacts(label, r.leadConversion.converted);
    if (kind === 'leads') return drillContacts(label, r.leadConversion.leads);
    if (kind === 'program') return drillContacts(label, r.byProgram[key] || []);
    if (kind === 'overdue') return drillTasks(label, r.overdueTasks);
    if (kind === 'asesor') {
      const [i, field] = key.split(':');
      const a = r.byAsesor[Number(i)];
      return field === 'leads' ? drillContacts(label, a.leads) : drillDeals(label, a[field]);
    }
    return null;
  },
};
