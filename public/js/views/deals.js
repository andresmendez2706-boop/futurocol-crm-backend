import {
  S, api, esc, icon, isAdmin, canManage, userName, contactById, dealById, money, compactMoney, pct, fmtDate,
  fmtDateTime, stageLabel, options, dealProbability, isClosedStage, inPeriod, billingDate, periodLabel,
  savePrefs, cachedDashboard, canEditTask, currencyCode, lightDot, TASK_TYPE_LABELS, WON, LOST,
  inAllyFilter, allyName, multiAlly, programsFor, myAllies,
  docTypes, requiredDocTypes, missingDocs, fileSize,
} from '../core.js';
import { taskForm } from './tasks.js';
import {
  formModal, openModal, confirmDialog, alertDialog, promptDialog, toast, emptyState, periodPicker, assigneeField,
  allyPicker, allyField, bindAllyPrograms,
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
    ${multiAlly() ? `<span class="chip chip-sm chip-ally">${esc(allyName(d.allyId))}</span>` : ''}
    ${d.product || d.dealType ? `<span class="chip chip-sm">${esc([d.dealType, d.product].filter(Boolean).join(' · '))}</span>` : ''}
    ${docsChip(d)}
    ${isAdmin() ? `<small class="owner">${esc(userName(d.assignedTo))}</small>` : ''}
    ${d.stage === LOST && d.lossReason ? `<small class="loss">Motivo: ${esc(d.lossReason)}</small>` : ''}
  </div>`;
}

// Aviso en la tarjeta: cuántos documentos obligatorios tiene (solo si le falta alguno).
function docsChip(d) {
  if (d.stage === LOST) return '';
  const total = requiredDocTypes().length;
  const missing = missingDocs(d).length;
  if (!total || !missing) return '';
  return `<span class="chip chip-sm chip-warn" title="Faltan: ${esc(missingDocs(d).map((t) => t.label).join(', '))}">${icon('clip')} Docs ${total - missing}/${total}</span>`;
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
  const list = S.deals.filter((d) => matches(d) && visibleInPeriod(d) && inAllyFilter(d));
  const c = stats.cards;
  return `
    <div class="page-head">
      <div><h1>Negocios</h1><p class="muted">Pipeline · cerrados de ${esc(periodLabel().toLowerCase())}</p></div>
      <div class="toolbar">
        <input id="deals-q" class="input" placeholder="Buscar negocio, contacto, programa…" value="${esc(u.q)}" data-input="deals-q">
        ${allyPicker()}
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
  // Obligatorio: cédula, diploma y acta de grado antes de cerrar como ganado (el servidor valida igual).
  if (stage === WON && missingDocs(deal).length) {
    await window.crm.refresh();
    await askForDocuments(deal, missingDocs(deal).map((t) => t.label));
    return;
  }
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
    if (err.code === 'DOCUMENTS_REQUIRED') {
      await window.crm.refresh();
      await askForDocuments(deal, (err.body.missing || []).map(docLabel));
      return;
    }
    toast(err.message, 'error');
  }
  await window.crm.refresh();
}

const docLabel = (id) => docTypes().find((t) => t.id === id)?.label || id;

async function askForDocuments(deal, labels) {
  const go = await confirmDialog(
    `Para marcar "${deal.title}" como ganado primero debes adjuntar:\n${labels.map((l) => `• ${l}`).join('\n')}`,
    { title: 'Faltan documentos obligatorios', okText: 'Adjuntar documentos' },
  );
  if (!go) return;
  if (!document.getElementById(`deal-docs-${deal.id}`)) openDeal(deal.id);
  const box = document.getElementById(`deal-docs-${deal.id}`);
  box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  box?.classList.add('flash');
  setTimeout(() => box?.classList.remove('flash'), 1800);
}

// ---------------------------------------------------------------- formulario
export function dealForm(deal = null, { contactId, stage } = {}) {
  const d = deal || {};
  const contacts = S.contacts.filter((c) => canManage(c) || c.id === d.contactId);
  const startAlly = d.allyId || contactById(d.contactId || contactId)?.allyId || myAllies()[0]?.id;
  const m = formModal({
    title: deal ? 'Editar negocio' : 'Nuevo negocio',
    size: 'lg',
    fields: [
      { name: 'title', label: 'Título', value: d.title, required: true },
      { name: 'contactId', label: 'Contacto', type: 'select', value: d.contactId || contactId, empty: 'Selecciona un contacto', required: true, options: contacts.map((c) => ({ value: c.id, label: `${c.name}${multiAlly() ? ` · ${allyName(c.allyId)}` : ''}` })) },
      allyField(startAlly),
      { name: 'value', label: `Valor (${currencyCode()})`, type: 'number', min: 0, step: 1000, value: d.value ?? '' },
      // Un negocio nuevo no puede nacer ganado: primero se adjuntan los documentos obligatorios.
      deal ? null : { name: 'stage', label: 'Etapa', type: 'select', value: stage && stage !== WON ? stage : S.settings.stages[0]?.id, options: S.settings.stages.filter((s) => s.id !== WON).map((s) => ({ value: s.id, label: s.label })), hint: 'Para "Cierre ganado", crea el negocio, adjunta los documentos y luego márcalo como ganado.' },
      { name: 'dealType', label: 'Tipo', type: 'select', value: d.dealType, empty: '—', options: S.constants.dealTypes },
      { name: 'product', label: 'Producto / programa', type: 'select', value: d.product, empty: 'Sin programa', options: programsFor(startAlly) },
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
  bindAllyPrograms(m, 'product');
  // Al elegir el contacto, el negocio toma el aliado de ese contacto.
  m.query('[name="contactId"]')?.addEventListener('change', (e) => {
    const c = contactById(e.target.value);
    const sel = m.query('[name="allyId"]');
    if (c?.allyId && sel && [...sel.options].some((o) => o.value === c.allyId)) {
      sel.value = c.allyId;
      sel.dispatchEvent(new Event('change'));
    }
  });
}

// ---------------------------------------------------------------- detalle
function dealTasksHtml(d, manage) {
  const tasks = S.tasks.filter((t) => t.dealId === d.id).sort((a, b) => (a.done - b.done) || String(a.dueDate).localeCompare(String(b.dueDate)));
  return `<div class="section-head"><h4>Tareas de seguimiento (${tasks.length})</h4>
      ${manage ? `<button class="btn btn-sm" data-action="deal-new-task" data-id="${esc(d.id)}">${icon('plus')} Programar tarea</button>` : ''}</div>
    ${tasks.length ? `<ul class="mini-list">${tasks.map((t) => `<li class="${t.done ? 'done' : ''}">
      ${lightDot(t)}
      ${canEditTask(t) ? `<input type="checkbox" data-change="toggle-task" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} title="Completada">` : ''}
      <a href="#" data-action="open-task" data-id="${esc(t.id)}">${esc(t.title)}</a>
      <small>${esc(TASK_TYPE_LABELS[t.type] || t.type)} · ${fmtDate(t.dueDate)}${t.contactTime ? ` ${esc(t.contactTime)}` : ''}${isAdmin() ? ` · ${esc(userName(t.assignedTo))}` : ''}</small></li>`).join('')}</ul>`
    : '<p class="muted">Sin tareas programadas para este negocio.</p>'}`;
}

// ---------------------------------------------------------------- documentos
const ACCEPT = 'application/pdf,image/*';

function documentsHtml(d, manage) {
  const docs = d.documents || [];
  const missing = missingDocs(d);
  const fileLine = (f) => `<li class="doc-file">
      <div class="doc-file-info">
        <a href="/api/deals/${esc(d.id)}/documents/${esc(f.id)}" target="_blank" rel="noopener" title="Ver documento">${icon('eye')} ${esc(f.fileName)}</a>
        <small class="muted">${fileSize(f.size)} · ${fmtDate(f.createdAt)}${f.uploadedByName ? ` · ${esc(f.uploadedByName)}` : ''}</small>
      </div>
      ${manage ? `<button class="icon-btn danger" data-action="deal-doc-delete" data-id="${esc(d.id)}" data-doc="${esc(f.id)}" title="Eliminar">${icon('trash')}</button>` : ''}
    </li>`;
  const rows = docTypes().map((t) => {
    const files = docs.filter((f) => f.type === t.id);
    const lacking = t.required && !files.length;
    return `<div class="doc-row${lacking ? ' missing' : ''}${files.length ? ' ok' : ''}">
      <div class="doc-type">
        <span class="doc-status">${files.length ? '✓' : t.required ? '!' : '·'}</span>
        <div><strong>${esc(t.label)}</strong><small class="block muted">${t.required ? 'Obligatorio' : 'Opcional'}</small></div>
      </div>
      <div class="doc-files">${files.length ? `<ul>${files.map(fileLine).join('')}</ul>` : `<span class="${lacking ? 'doc-missing' : 'muted'}">${lacking ? 'Falta adjuntar' : 'Sin archivos'}</span>`}</div>
      ${manage ? `<label class="btn btn-sm doc-upload">${icon('clip')} ${files.length ? 'Agregar' : 'Adjuntar'}
        <input type="file" hidden accept="${ACCEPT}" data-change="deal-doc-upload" data-id="${esc(d.id)}" data-type="${esc(t.id)}"></label>` : ''}
    </div>`;
  }).join('');
  return `<section class="deal-docs" id="deal-docs-${esc(d.id)}">
    <div class="section-head"><h4>Documentos</h4>
      ${missing.length ? `<span class="chip chip-warn">Faltan ${missing.length} obligatorio(s)</span>` : '<span class="chip chip-ok">Documentos completos</span>'}</div>
    <p class="muted small">Cédula, diploma y acta de grado son obligatorios para marcar el negocio como ganado. PDF o foto, máximo ${fileSize(S.constants.maxDocumentBytes || 5242880)} por archivo.</p>
    <div class="doc-list">${rows}</div>
  </section>`;
}

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// Las fotos grandes (p. ej. de la cámara del celular) se reducen antes de subirlas.
async function toJpeg(file, maxSide = 2000, quality = 0.85) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', quality));
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(new Error('No se pudo leer el archivo'));
  r.readAsDataURL(blob);
});

async function prepareFile(file) {
  let blob = file;
  let name = file.name || 'documento';
  const isImage = file.type.startsWith('image/');
  // Imágenes en otro formato (p. ej. HEIC del iPhone) o muy pesadas → JPEG.
  if (isImage && (!ALLOWED.includes(file.type) || file.size > 900 * 1024)) {
    try {
      const jpg = await toJpeg(file);
      if (!ALLOWED.includes(file.type) || jpg.size < file.size) {
        blob = jpg;
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      }
    } catch {
      if (!ALLOWED.includes(file.type)) throw new Error('Formato no permitido: adjunta un PDF o una foto (JPG o PNG).');
    }
  } else if (!ALLOWED.includes(file.type)) {
    throw new Error('Formato no permitido: adjunta un PDF o una foto (JPG o PNG).');
  }
  const max = S.constants.maxDocumentBytes || 5242880;
  if (blob.size > max) throw new Error(`El archivo pesa ${fileSize(blob.size)}; el máximo es ${fileSize(max)}.`);
  return { fileName: name, data: await toBase64(blob) };
}

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
      <div><small>Aliado</small><span>${esc(allyName(d.allyId))}</span></div>
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
    ${documentsHtml(d, manage)}
    ${dealTasksHtml(d, manage)}
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
  'deal-new-task': (el) => {
    const d = dealById(el.dataset.id);
    if (d) taskForm(null, { dealId: d.id, contactId: d.contactId });
  },
  'deal-win': (el) => moveDeal(dealById(el.dataset.id), WON),
  'deal-doc-delete': async (el) => {
    const d = dealById(el.dataset.id);
    const f = d?.documents?.find((x) => x.id === el.dataset.doc);
    if (!f) return;
    const ok = await confirmDialog(`¿Eliminar "${f.fileName}" (${docLabel(f.type)})?`, { title: 'Eliminar documento', okText: 'Eliminar', danger: true });
    if (!ok) return;
    await api('DELETE', `/api/deals/${d.id}/documents/${f.id}`);
    toast('Documento eliminado');
    await window.crm.refresh();
  },
  'deal-lose': (el) => moveDeal(dealById(el.dataset.id), LOST),
  'deals-layout': (el) => {
    ui().layout = el.dataset.layout;
    savePrefs({ dealsLayout: el.dataset.layout });
    window.crm.render();
  },
};

export const changes = {
  'deal-stage': (el) => moveDeal(dealById(el.dataset.id), el.value),
  'deal-doc-upload': async (el) => {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    const label = el.closest('label');
    label?.classList.add('loading');
    try {
      const payload = await prepareFile(file);
      toast('Subiendo documento…');
      await api('POST', `/api/deals/${el.dataset.id}/documents`, { type: el.dataset.type, ...payload });
      toast(`Documento adjuntado: ${docLabel(el.dataset.type)}`);
      await window.crm.refresh();
    } catch (err) {
      await alertDialog(err.message, { title: 'No se pudo adjuntar' });
    } finally {
      label?.classList.remove('loading');
    }
  },
};

export const inputs = {
  'deals-q': (el) => { ui().q = el.value; window.crm.render(); },
};
