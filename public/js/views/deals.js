import {
  S, api, esc, icon, isAdmin, canManage, userName, contactById, dealById, money, compactMoney, pct, fmtDate,
  fmtDateTime, stageLabel, options, dealProbability, isClosedStage, inPeriod, billingDate, periodLabel,
  savePrefs, cachedDashboard, WON, LOST,
} from '../core.js';
import {
  formModal, openModal, confirmDialog, promptDialog, toast, emptyState, periodPicker, assigneeField,
} from '../ui.js';

export const id = 'negocios';
export const title = 'Negocios';
export const navIcon = 'negocios';

const ui = () => (S.ui.deals ||= { q: '', layout: S.me.prefs?.dealsLayout || 'kanban' });

function matches(d) {
  const t = ui().q.trim().toLowerCase();
  if (!t) return true;
  const c = contactById(d.contactId);
  return [d.title, d.product, d.dealType, d.convocatoria, c?.name, c?.email, userName(d.assignedTo)]
    .some((v) => v && v.toLowerCase().includes(t));
}

// Los cerrados (ganado/perdido) se muestran según el período seleccionado; los abiertos siempre.
const closeOf = (d) => (d.stage === WON ? billingDate(d) : d.closeDate || (d.stageHistory?.at(-1)?.at || '').slice(0, 10));
const visibleInPeriod = (d) => ![WON, LOST].includes(d.stage) || inPeriod(closeOf(d));

function dealCard(d) {
  const c = contactById(d.contactId);
  const drag = canManage(d);
  return `<div class="deal-card${drag ? '' : ' readonly'}" ${drag ? 'draggable="true"' : ''} data-deal="${esc(d.id)}" data-action="open-deal" data-id="${esc(d.id)}">
    <strong>${esc(d.title)}</strong>
    <small class="block">${esc(c?.name || 'Sin contacto')}</small>
    <div class="deal-card-meta">
      <span class="deal-value">${compactMoney(d.value)}</span>
      ${!isClosedStage(d.stage) ? `<span class="muted">${dealProbability(d)}%</span>` : ''}
    </div>
    ${d.product || d.dealType ? `<span class="chip chip-sm">${esc([d.dealType, d.product].filter(Boolean).join(' · '))}</span>` : ''}
    ${isAdmin() ? `<small class="owner">${esc(userName(d.assignedTo))}</small>` : ''}
    ${d.stage === LOST && d.lossReason ? `<small class="loss">Motivo: ${esc(d.lossReason)}</small>` : ''}
  </div>`;
}

function kanban(list) {
  return `<div class="kanban" data-scroll-key="board">${S.settings.stages.map((s) => {
    const ds = list.filter((d) => d.stage === s.id);
    const total = ds.reduce((a, d) => a + Number(d.value || 0), 0);
    return `<div class="kanban-col stage-${esc(s.id)}" data-stage="${esc(s.id)}">
      <div class="kanban-col-head"><strong>${esc(s.label)}</strong><span class="badge">${ds.length}</span>
        <small class="block muted">${compactMoney(total)}</small></div>
      <div class="kanban-col-body" data-scroll-key="col-${esc(s.id)}">${ds.map(dealCard).join('') || '<div class="kanban-empty">Arrastra aquí</div>'}</div>
    </div>`;
  }).join('')}</div>`;
}

function listView(list) {
  if (!list.length) return emptyState('No hay negocios que coincidan.');
  return `<div class="card no-pad"><div class="table-wrap"><table class="table">
    <thead><tr><th>Negocio</th><th>Contacto</th><th>Etapa</th><th class="num">Valor</th><th class="num">Prob.</th><th>Tipo</th><th>Programa</th><th>Responsable</th><th>Cierre esperado</th><th>Cierre</th></tr></thead>
    <tbody>${list.map((d) => `<tr class="clickable" data-action="open-deal" data-id="${esc(d.id)}">
      <td><strong>${esc(d.title)}</strong></td><td>${esc(contactById(d.contactId)?.name || '—')}</td>
      <td><span class="stage-pill stage-${esc(d.stage)}">${esc(stageLabel(d.stage))}</span></td>
      <td class="num">${money(d.value)}</td><td class="num">${dealProbability(d)}%</td><td>${esc(d.dealType || '—')}</td>
      <td>${esc(d.product || '—')}</td><td>${esc(userName(d.assignedTo))}</td><td>${fmtDate(d.expectedCloseDate)}</td><td>${fmtDate(d.closeDate)}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}

export async function render() {
  const u = ui();
  const stats = await cachedDashboard();
  const list = S.deals.filter((d) => matches(d) && visibleInPeriod(d));
  const c = stats.cards;
  return `
    <div class="page-head">
      <div><h1>Negocios</h1><p class="muted">Pipeline · cerrados de ${esc(periodLabel().toLowerCase())}</p></div>
      <div class="toolbar">
        <input id="deals-q" class="input" placeholder="Buscar negocio, contacto, programa…" value="${esc(u.q)}" data-input="deals-q">
        ${periodPicker()}
        <div class="seg">
          <button class="seg-btn ${u.layout === 'kanban' ? 'active' : ''}" data-action="deals-layout" data-layout="kanban" title="Kanban">${icon('columns')}</button>
          <button class="seg-btn ${u.layout === 'lista' ? 'active' : ''}" data-action="deals-layout" data-layout="lista" title="Lista">${icon('list')}</button>
        </div>
        ${isAdmin() ? `<a class="btn" href="/api/deals/export.csv" download>${icon('download')} Exportar</a>` : ''}
        <button class="btn btn-primary" data-action="new-deal">${icon('plus')} Nuevo negocio</button>
      </div>
    </div>
    <div class="summary-strip">
      <div><small>Abiertos</small><strong>${c.openDeals}</strong></div>
      <div><small>Valor en trámite</small><strong>${compactMoney(c.openValue)}</strong></div>
      <div><small>Ganados (${esc(periodLabel())})</small><strong>${c.wonCount}</strong></div>
      <div><small>Facturación</small><strong>${compactMoney(c.billing)}</strong></div>
      ${isAdmin() ? `
        <div class="sep"><small>Comisión asesores</small><strong>${money(c.asesoresCommission)}</strong></div>
        <div class="sep"><small>Comisión admin</small><strong>${money(c.adminCommission)}</strong></div>`
    : `<div class="sep"><small>Mi comisión (${pct(c.myRate)})</small><strong>${money(c.myCommission)}</strong></div>`}
    </div>
    ${u.layout === 'kanban' ? kanban(list) : listView(list)}`;
}

// ---------------------------------------------------------------- arrastrar y soltar
export function mount(root) {
  const board = root.querySelector('.kanban');
  if (!board) return;
  let dragId = null;
  // Auto-desplazamiento horizontal del tablero al arrastrar cerca de los bordes,
  // para poder llegar a columnas que no están a la vista (p. ej. "Cierre perdido").
  let edge = 0;
  let edgeTimer = null;
  const onDocDragOver = (e) => {
    const r = board.getBoundingClientRect();
    const zone = 80;
    edge = e.clientX > r.right - zone ? 1 : e.clientX < r.left + zone ? -1 : 0;
  };
  const stopEdge = () => {
    clearInterval(edgeTimer);
    edgeTimer = null;
    edge = 0;
    document.removeEventListener('dragover', onDocDragOver);
  };
  board.addEventListener('dragstart', (e) => {
    document.addEventListener('dragover', onDocDragOver);
    edgeTimer = setInterval(() => { if (edge) board.scrollLeft += edge * 18; }, 16);
    const card = e.target.closest('[data-deal]');
    if (!card) return;
    dragId = card.dataset.deal;
    S.ui.dragging = true;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  board.addEventListener('dragend', (e) => {
    stopEdge();
    e.target.closest('[data-deal]')?.classList.remove('dragging');
    board.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    S.ui.dragging = false;
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kanban-col');
    if (!col || !dragId) return;
    e.preventDefault();
    board.querySelectorAll('.drop-target').forEach((x) => x !== col && x.classList.remove('drop-target'));
    col.classList.add('drop-target');
  });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.kanban-col');
    if (!col) return;
    e.preventDefault();
    const idDrop = e.dataTransfer.getData('text/plain') || dragId;
    dragId = null;
    stopEdge();
    S.ui.dragging = false;
    col.classList.remove('drop-target');
    await moveDeal(dealById(idDrop), col.dataset.stage);
  });
}

// Cambio de etapa con las reglas obligatorias (motivo de pérdida). El servidor valida igual.
export async function moveDeal(deal, stage) {
  if (!deal || deal.stage === stage) return;
  if (!canManage(deal)) { toast('No puedes mover este negocio', 'error'); return; }
  const body = { stage };
  if (stage === LOST && !deal.lossReason) {
    const reasons = [...new Set(S.deals.map((d) => d.lossReason).filter(Boolean))].slice(0, 20);
    const reason = await promptDialog('¿Por qué se perdió este negocio?', {
      title: `Motivo de pérdida · ${deal.title}`, placeholder: 'Ej.: precio, eligió otra universidad…', choices: reasons, okText: 'Cerrar como perdido',
    });
    if (!reason) { toast('Cambio cancelado: el motivo de pérdida es obligatorio', 'error'); await window.crm.refresh(); return; }
    body.lossReason = reason;
  }
  try {
    await api('PATCH', `/api/deals/${deal.id}`, body);
    toast(stage === WON ? '¡Negocio ganado! 🎉' : `Movido a "${stageLabel(stage)}"`);
  } catch (err) {
    toast(err.message, 'error');
  }
  await window.crm.refresh();
}

// ---------------------------------------------------------------- formulario
export function dealForm(deal = null, { contactId, stage } = {}) {
  const d = deal || {};
  const contacts = S.contacts.filter((c) => canManage(c) || c.id === d.contactId);
  formModal({
    title: deal ? 'Editar negocio' : 'Nuevo negocio',
    size: 'lg',
    fields: [
      { name: 'title', label: 'Título', value: d.title, required: true },
      { name: 'contactId', label: 'Contacto', type: 'select', value: d.contactId || contactId, empty: 'Selecciona un contacto', required: true, options: contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'value', label: 'Valor (COP)', type: 'number', min: 0, step: 1000, value: d.value ?? '' },
      deal ? null : { name: 'stage', label: 'Etapa', type: 'select', value: stage || S.settings.stages[0]?.id, options: S.settings.stages.map((s) => ({ value: s.id, label: s.label })) },
      { name: 'dealType', label: 'Tipo', type: 'select', value: d.dealType, empty: '—', options: S.constants.dealTypes },
      { name: 'product', label: 'Producto / programa', type: 'select', value: d.product, empty: '—', options: S.constants.programs },
      { name: 'convocatoria', label: 'Convocatoria', value: d.convocatoria },
      { name: 'probability', label: 'Probabilidad (%)', type: 'number', min: 0, max: 100, value: d.probability ?? '', placeholder: 'Por defecto según etapa' },
      { name: 'expectedCloseDate', label: 'Cierre esperado', type: 'date', value: d.expectedCloseDate },
      { name: 'competitor', label: 'Competidor', value: d.competitor },
      assigneeField(d.assignedTo),
      { name: 'nextStep', label: 'Siguiente paso', value: d.nextStep, full: true },
      { name: 'lossReason', label: 'Motivo de pérdida', value: d.lossReason, full: true, hint: 'Obligatorio si el negocio está o pasa a "Cierre perdido".' },
    ],
    onSubmit: async (v) => {
      const targetStage = v.stage || d.stage;
      if (targetStage === LOST && !v.lossReason.trim()) throw new Error('Indica el motivo de pérdida.');
      const saved = deal ? await api('PATCH', `/api/deals/${deal.id}`, v) : await api('POST', '/api/deals', v);
      toast(deal ? 'Negocio actualizado' : 'Negocio creado');
      await window.crm.refresh();
      return saved && true;
    },
  });
}

// ---------------------------------------------------------------- detalle
function detailHtml(d) {
  const c = contactById(d.contactId);
  const manage = canManage(d);
  const history = [...(d.stageHistory || [])].reverse();
  const probManual = d.probability !== null && d.probability !== undefined;
  return `
    <div class="deal-detail-top">
      <div class="big-value">${money(d.value)}</div>
      ${manage ? `<label class="field inline"><span>Etapa</span>
        <select class="input" data-change="deal-stage" data-id="${esc(d.id)}">${options(S.settings.stages.map((s) => ({ value: s.id, label: s.label })), d.stage)}</select></label>`
    : `<span class="stage-pill stage-${esc(d.stage)}">${esc(stageLabel(d.stage))}</span>`}
      ${manage && !isClosedStage(d.stage) ? `<button class="btn btn-success btn-sm" data-action="deal-win" data-id="${esc(d.id)}">Marcar ganado</button>
        <button class="btn btn-danger-ghost btn-sm" data-action="deal-lose" data-id="${esc(d.id)}">Marcar perdido</button>` : ''}
    </div>
    <div class="detail-grid">
      <div><small>Contacto</small><span>${c ? `<a href="#" data-action="open-contact" data-id="${esc(c.id)}">${esc(c.name)}</a>` : '—'}</span></div>
      <div><small>Tipo</small><span>${esc(d.dealType || '—')}</span></div>
      <div><small>Programa</small><span>${esc(d.product || '—')}</span></div>
      <div><small>Convocatoria</small><span>${esc(d.convocatoria || '—')}</span></div>
      <div><small>Probabilidad</small><span>${dealProbability(d)}%${probManual ? '' : ' <small class="muted">(por etapa)</small>'}</span></div>
      <div><small>Cierre esperado</small><span>${fmtDate(d.expectedCloseDate)}</span></div>
      <div><small>Fecha de cierre</small><span>${fmtDate(d.closeDate)}</span></div>
      <div><small>Competidor</small><span>${esc(d.competitor || '—')}</span></div>
      <div><small>Responsable</small><span>${esc(userName(d.assignedTo))}</span></div>
      <div><small>Creado</small><span>${fmtDateTime(d.createdAt)}</span></div>
      <div class="full"><small>Siguiente paso</small><span>${esc(d.nextStep || '—')}</span></div>
      ${d.lossReason ? `<div class="full"><small>Motivo de pérdida</small><span class="loss">${esc(d.lossReason)}</span></div>` : ''}
    </div>
    <h4>Historial de etapas</h4>
    ${history.length ? `<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Fecha</th><th>De</th><th>A</th><th>Por</th></tr></thead>
      <tbody>${history.map((h) => `<tr><td>${fmtDateTime(h.at)}</td><td>${h.from ? esc(stageLabel(h.from)) : '<span class="muted">(creación)</span>'}</td>
        <td><span class="stage-pill stage-${esc(h.stage)}">${esc(stageLabel(h.stage))}</span></td><td>${esc(h.by || '—')}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Sin cambios de etapa registrados.</p>'}`;
}

export function openDeal(dealId) {
  const d = dealById(dealId);
  if (!d) return;
  const footer = () => {
    const cur = dealById(dealId);
    return `${isAdmin() ? `<button class="btn btn-danger-ghost" data-action="delete-deal" data-id="${esc(dealId)}">${icon('trash')} Eliminar</button>` : ''}
      <span class="spacer"></span>
      ${cur && canManage(cur) ? `<button class="btn btn-primary" data-action="edit-deal" data-id="${esc(dealId)}">${icon('edit')} Editar</button>` : ''}`;
  };
  const m = openModal({
    title: d.title,
    size: 'lg',
    body: detailHtml(d),
    footer: footer(),
    onData: () => {
      const cur = dealById(dealId);
      if (!cur) { m.close(); return; }
      m.setBody(detailHtml(cur));
      m.setFooter(footer());
    },
  });
}

export const actions = {
  'new-deal': () => dealForm(),
  'open-deal': (el, e) => {
    if (el.classList.contains('dragging')) return;
    e?.stopPropagation?.();
    openDeal(el.dataset.id);
  },
  'edit-deal': (el) => dealForm(dealById(el.dataset.id)),
  'delete-deal': async (el) => {
    const d = dealById(el.dataset.id);
    if (!d) return;
    const ok = await confirmDialog(`¿Eliminar el negocio "${d.title}"? Esta acción no se puede deshacer.`, { title: 'Eliminar negocio', okText: 'Eliminar', danger: true });
    if (!ok) return;
    await api('DELETE', `/api/deals/${d.id}`);
    toast('Negocio eliminado');
    await window.crm.refresh();
  },
  'deal-win': (el) => moveDeal(dealById(el.dataset.id), WON),
  'deal-lose': (el) => moveDeal(dealById(el.dataset.id), LOST),
  'deals-layout': (el) => {
    ui().layout = el.dataset.layout;
    savePrefs({ dealsLayout: el.dataset.layout });
    window.crm.render();
  },
};

export const changes = {
  'deal-stage': (el) => moveDeal(dealById(el.dataset.id), el.value),
};

export const inputs = {
  'deals-q': (el) => { ui().q = el.value; window.crm.render(); },
};
