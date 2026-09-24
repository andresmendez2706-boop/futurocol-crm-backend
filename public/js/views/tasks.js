import {
  S, api, esc, icon, isAdmin, canManage, canEditTask, userName, contactById, taskById, fmtDate, fmtDateTime,
  options, TASK_TYPE_LABELS, lightDot, taskLight, addDays,
} from '../core.js';
import {
  formModal, openModal, confirmDialog, toast, emptyState, assigneeField,
} from '../ui.js';

export const id = 'tareas';
export const title = 'Tareas';
export const navIcon = 'tareas';

const ui = () => (S.ui.tasks ||= { q: '', status: 'pendientes', owner: '', type: '' });

const STATUS = [
  { value: 'pendientes', label: 'Pendientes' },
  { value: 'vencidas', label: 'Vencidas' },
  { value: 'hoy', label: 'Hoy y mañana' },
  { value: 'completadas', label: 'Completadas' },
  { value: 'todas', label: 'Todas' },
];

function filtered() {
  const u = ui();
  const t = u.q.trim().toLowerCase();
  return S.tasks.filter((x) => {
    const light = taskLight(x);
    if (u.status === 'pendientes' && x.done) return false;
    if (u.status === 'vencidas' && light !== 'rojo') return false;
    if (u.status === 'hoy' && (x.done || !x.dueDate || x.dueDate < S.today || x.dueDate > addDays(S.today, 1))) return false;
    if (u.status === 'completadas' && !x.done) return false;
    if (u.owner && x.assignedTo !== u.owner) return false;
    if (u.type && x.type !== u.type) return false;
    if (!t) return true;
    return [x.title, x.notes, contactById(x.contactId)?.name].some((v) => v && v.toLowerCase().includes(t));
  }).sort((a, b) => (a.done - b.done) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
    || String(a.contactTime || '').localeCompare(String(b.contactTime || '')));
}

export function taskRow(t, { showOwner = isAdmin() } = {}) {
  const c = contactById(t.contactId);
  const own = canEditTask(t);
  return `<tr class="${t.done ? 'done' : ''}">
    <td class="dot-cell">${lightDot(t)}</td>
    <td>${own ? `<input type="checkbox" data-change="toggle-task" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} title="Marcar como completada">` : `<span class="muted" title="Solo lectura">${icon('lock', 'ico-sm')}</span>`}</td>
    <td><a href="#" data-action="open-task" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></a>${t.autoRule ? ' <span class="chip chip-sm chip-auto">auto</span>' : ''}</td>
    <td>${esc(TASK_TYPE_LABELS[t.type] || t.type)}</td>
    <td>${c ? `<a href="#" data-action="open-contact" data-id="${esc(c.id)}">${esc(c.name)}</a>` : '—'}</td>
    <td>${fmtDate(t.dueDate)}</td>
    <td>${esc(t.contactTime || '—')}</td>
    <td>${esc(t.scheduleTime || '—')}</td>
    ${showOwner ? `<td>${esc(userName(t.assignedTo))}</td>` : ''}
    <td class="actions">${own ? `<button class="icon-btn" data-action="edit-task" data-id="${esc(t.id)}" title="Editar">${icon('edit')}</button>
      <button class="icon-btn danger" data-action="delete-task" data-id="${esc(t.id)}" title="Eliminar">${icon('trash')}</button>` : ''}</td>
  </tr>`;
}

export const taskTableHead = (showOwner = isAdmin()) => `<thead><tr><th></th><th></th><th>Tarea</th><th>Tipo</th><th>Contacto</th><th>Vence</th><th>Hora contacto</th><th>Agendamiento</th>${showOwner ? '<th>Responsable</th>' : ''}<th></th></tr></thead>`;

export function render() {
  const u = ui();
  const list = filtered();
  const overdue = S.tasks.filter((t) => taskLight(t) === 'rojo').length;
  return `
    <div class="page-head">
      <div><h1>Tareas</h1><p class="muted">${list.length} tarea(s) · <span class="dot dot-rojo"></span> ${overdue} vencida(s)</p></div>
      <div class="toolbar">
        <input id="tasks-q" class="input" placeholder="Buscar tarea o contacto…" value="${esc(u.q)}" data-input="tasks-q">
        <select class="input input-sm" data-change="tasks-status">${options(STATUS, u.status)}</select>
        <select class="input input-sm" data-change="tasks-type">${options(S.constants.taskTypes.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] })), u.type, { empty: 'Todos los tipos' })}</select>
        ${isAdmin() ? `<select class="input input-sm" data-change="tasks-owner">${options(S.users.map((x) => ({ value: x.id, label: x.name })), u.owner, { empty: 'Todos los usuarios' })}</select>` : ''}
        <button class="btn btn-primary" data-action="new-task">${icon('plus')} Nueva tarea</button>
      </div>
    </div>
    ${isAdmin() ? '<p class="note">Como administrador ves todas las tareas. Las de otros usuarios son de solo lectura.</p>' : ''}
    <div class="legend"><span><span class="dot dot-rojo"></span> Vencida</span><span><span class="dot dot-amarillo"></span> Vence hoy o mañana</span><span><span class="dot dot-verde"></span> Completada o a tiempo</span></div>
    <div class="card no-pad">${list.length ? `<div class="table-wrap"><table class="table">${taskTableHead()}<tbody>${list.map((t) => taskRow(t)).join('')}</tbody></table></div>` : emptyState('No hay tareas con estos filtros.')}</div>`;
}

export function taskForm(task = null, { contactId, dueDate } = {}) {
  const t = task || {};
  const contacts = S.contacts.filter((c) => canManage(c) || c.id === t.contactId);
  formModal({
    title: task ? 'Editar tarea' : 'Nueva tarea',
    fields: [
      { name: 'title', label: 'Título', value: t.title, required: true, full: true },
      { name: 'contactId', label: 'Contacto', type: 'select', value: t.contactId || contactId, empty: 'Sin contacto', options: contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'type', label: 'Tipo', type: 'select', value: t.type || 'llamada', options: S.constants.taskTypes.map((x) => ({ value: x, label: TASK_TYPE_LABELS[x] })) },
      { name: 'dueDate', label: 'Fecha límite', type: 'date', value: t.dueDate || dueDate || S.today },
      { name: 'contactTime', label: 'Hora de contacto', type: 'time', value: t.contactTime },
      { name: 'scheduleTime', label: 'Hora de agendamiento', type: 'time', value: t.scheduleTime },
      task ? null : assigneeField(t.assignedTo),
      { name: 'notes', label: 'Notas', type: 'textarea', value: t.notes, full: true },
      task ? { name: 'done', label: 'Completada', type: 'checkbox', value: t.done } : null,
    ],
    onSubmit: async (v) => {
      if (task) await api('PATCH', `/api/tasks/${task.id}`, v);
      else await api('POST', '/api/tasks', v);
      toast(task ? 'Tarea actualizada' : 'Tarea creada');
      await window.crm.refresh();
    },
  });
}

export function openTask(taskId) {
  const t = taskById(taskId);
  if (!t) return;
  const c = contactById(t.contactId);
  const own = canEditTask(t);
  openModal({
    title: t.title,
    body: `
      <div class="detail-grid">
        <div><small>Estado</small><span>${lightDot(t)} ${t.done ? `Completada ${fmtDateTime(t.completedAt)}` : taskLight(t) === 'rojo' ? 'Vencida' : 'Pendiente'}</span></div>
        <div><small>Tipo</small><span>${esc(TASK_TYPE_LABELS[t.type] || t.type)}</span></div>
        <div><small>Contacto</small><span>${c ? `<a href="#" data-action="open-contact" data-id="${esc(c.id)}">${esc(c.name)}</a>` : '—'}</span></div>
        <div><small>Fecha límite</small><span>${fmtDate(t.dueDate)}</span></div>
        <div><small>Hora de contacto</small><span>${esc(t.contactTime || '—')}</span></div>
        <div><small>Hora de agendamiento</small><span>${esc(t.scheduleTime || '—')}</span></div>
        <div><small>Responsable</small><span>${esc(userName(t.assignedTo))}</span></div>
        <div><small>Creada</small><span>${fmtDateTime(t.createdAt)}${t.autoRule ? ' · automática' : ''}</span></div>
      </div>
      ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
      ${!own ? '<p class="note">Solo lectura: solo el responsable puede modificar esta tarea.</p>' : ''}`,
    footer: own ? `<button class="btn btn-danger-ghost" data-action="delete-task" data-id="${esc(t.id)}" data-close>${icon('trash')} Eliminar</button><span class="spacer"></span>
      <button class="btn btn-primary" data-action="edit-task" data-id="${esc(t.id)}" data-close>${icon('edit')} Editar</button>` : '<button class="btn" data-close>Cerrar</button>',
  });
}

export const actions = {
  'new-task': () => taskForm(),
  'open-task': (el) => openTask(el.dataset.id),
  'edit-task': (el) => taskForm(taskById(el.dataset.id)),
  'delete-task': async (el) => {
    const t = taskById(el.dataset.id);
    if (!t) return;
    const ok = await confirmDialog(`¿Eliminar la tarea "${t.title}"?`, { title: 'Eliminar tarea', okText: 'Eliminar', danger: true });
    if (!ok) return;
    await api('DELETE', `/api/tasks/${t.id}`);
    toast('Tarea eliminada');
    await window.crm.refresh();
  },
};

export const changes = {
  'toggle-task': async (el) => {
    el.disabled = true;
    await api('PATCH', `/api/tasks/${el.dataset.id}`, { done: el.checked });
    toast(el.checked ? 'Tarea completada' : 'Tarea reabierta');
    await window.crm.refresh();
  },
  'tasks-status': (el) => { ui().status = el.value; window.crm.render(); },
  'tasks-type': (el) => { ui().type = el.value; window.crm.render(); },
  'tasks-owner': (el) => { ui().owner = el.value; window.crm.render(); },
};

export const inputs = {
  'tasks-q': (el) => { ui().q = el.value; window.crm.render(); },
};
