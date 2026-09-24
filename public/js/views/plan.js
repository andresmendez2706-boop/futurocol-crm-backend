import {
  S, esc, icon, isAdmin, options, contactById, userName, lightDot, taskLight, addDays, localISO, savePrefs,
  MONTHS, MONTHS_SHORT, WEEKDAYS, TASK_TYPE_LABELS,
} from '../core.js';
import { emptyState } from '../ui.js';
import { taskForm } from './tasks.js';

export const id = 'plan';
export const title = 'Plan de trabajo';
export const navIcon = 'plan';

const MODES = [{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }, { value: 'anio', label: 'Año' }];

const ui = () => (S.ui.plan ||= {
  mode: S.me.prefs?.planMode || 'semana',
  layout: S.me.prefs?.planLayout || 'panel',
  anchor: S.today,
  owner: isAdmin() ? '' : S.me.id,
});

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const weekStart = (iso) => { const d = parse(iso); const dow = (d.getDay() + 6) % 7; return addDays(iso, -dow); };

function range() {
  const { mode, anchor } = ui();
  const d = parse(anchor);
  if (mode === 'dia') return [anchor, anchor];
  if (mode === 'semana') { const s = weekStart(anchor); return [s, addDays(s, 6)]; }
  if (mode === 'mes') return [localISO(new Date(d.getFullYear(), d.getMonth(), 1)), localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
}

function rangeTitle() {
  const { mode, anchor } = ui();
  const d = parse(anchor);
  const [a, b] = range();
  if (mode === 'dia') return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (mode === 'semana') { const x = parse(a); const y = parse(b); return `${x.getDate()} ${MONTHS_SHORT[x.getMonth()]} – ${y.getDate()} ${MONTHS_SHORT[y.getMonth()]} ${y.getFullYear()}`; }
  if (mode === 'mes') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

function tasksIn(from, to) {
  const owner = ui().owner;
  return S.tasks.filter((t) => t.dueDate && t.dueDate >= from && t.dueDate <= to && (!owner || t.assignedTo === owner))
    .sort((x, y) => String(x.contactTime || x.scheduleTime || '99').localeCompare(String(y.contactTime || y.scheduleTime || '99')));
}

const chip = (t) => `<button class="task-chip ${t.done ? 'done' : ''}" data-action="open-task" data-id="${esc(t.id)}" title="${esc(t.title)}">
  ${lightDot(t)}<span>${t.contactTime ? `<b>${esc(t.contactTime)}</b> ` : ''}${esc(t.title)}</span></button>`;

function dayPanel(from) {
  const list = tasksIn(from, from);
  return `<div class="card">${list.length ? `<ul class="plan-day">${list.map((t) => `<li>
      <span class="plan-time">${esc(t.contactTime || t.scheduleTime || '—')}</span>
      ${lightDot(t)}
      <div><a href="#" data-action="open-task" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></a>
      <small class="block muted">${esc(TASK_TYPE_LABELS[t.type] || t.type)} · ${esc(contactById(t.contactId)?.name || 'Sin contacto')}${isAdmin() ? ` · ${esc(userName(t.assignedTo))}` : ''}</small></div>
    </li>`).join('')}</ul>` : emptyState('No hay tareas para este día.')}
    <button class="btn btn-sm" data-action="plan-new" data-date="${from}">${icon('plus')} Agregar tarea</button></div>`;
}

function weekPanel(from) {
  const days = [...Array(7)].map((_, i) => addDays(from, i));
  return `<div class="plan-week">${days.map((d, i) => {
    const date = parse(d);
    return `<div class="plan-col ${d === S.today ? 'today' : ''}">
      <div class="plan-col-head" data-action="plan-day" data-date="${d}">${WEEKDAYS[i]} <b>${date.getDate()}</b></div>
      <div class="plan-col-body" data-action="plan-new" data-date="${d}">${tasksIn(d, d).map(chip).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

function monthGrid(year, month, { mini = false } = {}) {
  const first = localISO(new Date(year, month, 1));
  const start = weekStart(first);
  const last = localISO(new Date(year, month + 1, 0));
  const cells = [];
  for (let d = start; cells.length < 42; d = addDays(d, 1)) {
    if (cells.length >= 35 && d > last && cells.length % 7 === 0) break;
    cells.push(d);
  }
  const all = tasksIn(cells[0], cells[cells.length - 1]);
  if (mini) {
    return `<div class="mini-month" data-action="plan-month" data-date="${first}">
      <div class="mini-month-title">${MONTHS[month]}</div>
      <div class="mini-grid">${WEEKDAYS.map((w) => `<span class="wd">${w[0]}</span>`).join('')}
      ${cells.map((d) => {
        const ts = all.filter((t) => t.dueDate === d);
        const inMonth = d.slice(5, 7) === String(month + 1).padStart(2, '0');
        const red = ts.some((t) => taskLight(t) === 'rojo');
        return `<span class="mini-day ${inMonth ? '' : 'out'} ${d === S.today ? 'today' : ''} ${ts.length ? (red ? 'has red' : 'has') : ''}" title="${ts.length} tarea(s)">${parse(d).getDate()}</span>`;
      }).join('')}</div>
      <small class="muted">${all.filter((t) => t.dueDate >= first && t.dueDate <= last).length} tarea(s)</small>
    </div>`;
  }
  return `<div class="plan-month">${WEEKDAYS.map((w) => `<div class="plan-wd">${w}</div>`).join('')}
    ${cells.map((d) => {
      const ts = all.filter((t) => t.dueDate === d);
      const inMonth = parse(d).getMonth() === month;
      return `<div class="plan-cell ${inMonth ? '' : 'out'} ${d === S.today ? 'today' : ''}" data-action="plan-new" data-date="${d}">
        <span class="plan-cell-day" data-action="plan-day" data-date="${d}">${parse(d).getDate()}</span>
        ${ts.slice(0, 3).map(chip).join('')}
        ${ts.length > 3 ? `<button class="more" data-action="plan-day" data-date="${d}">+${ts.length - 3} más</button>` : ''}
      </div>`;
    }).join('')}</div>`;
}

function listLayout(from, to) {
  const list = tasksIn(from, to).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!list.length) return `<div class="card">${emptyState('No hay tareas en este rango.')}</div>`;
  const groups = {};
  for (const t of list) (groups[t.dueDate] ||= []).push(t);
  return `<div class="card">${Object.entries(groups).map(([d, ts]) => {
    const date = parse(d);
    return `<div class="plan-group"><h4 class="${d === S.today ? 'today' : ''}">${WEEKDAYS[(date.getDay() + 6) % 7]} ${date.getDate()} de ${MONTHS[date.getMonth()]}</h4>
      <ul class="plan-day">${ts.map((t) => `<li><span class="plan-time">${esc(t.contactTime || t.scheduleTime || '—')}</span>${lightDot(t)}
        <div><a href="#" data-action="open-task" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></a>
        <small class="block muted">${esc(TASK_TYPE_LABELS[t.type] || t.type)} · ${esc(contactById(t.contactId)?.name || 'Sin contacto')}${isAdmin() ? ` · ${esc(userName(t.assignedTo))}` : ''}</small></div></li>`).join('')}</ul></div>`;
  }).join('')}</div>`;
}

export function render() {
  const u = ui();
  const [from, to] = range();
  const d = parse(u.anchor);
  let body;
  if (u.layout === 'lista') body = listLayout(from, to);
  else if (u.mode === 'dia') body = dayPanel(from);
  else if (u.mode === 'semana') body = weekPanel(from);
  else if (u.mode === 'mes') body = `<div class="card no-pad">${monthGrid(d.getFullYear(), d.getMonth())}</div>`;
  else body = `<div class="year-grid">${[...Array(12)].map((_, m) => monthGrid(d.getFullYear(), m, { mini: true })).join('')}</div>`;
  return `
    <div class="page-head">
      <div><h1>Plan de trabajo</h1><p class="muted">${esc(rangeTitle())}</p></div>
      <div class="toolbar">
        <div class="seg">${MODES.map((m) => `<button class="seg-btn ${u.mode === m.value ? 'active' : ''}" data-action="plan-mode" data-mode="${m.value}">${m.label}</button>`).join('')}</div>
        <div class="seg">
          <button class="seg-btn ${u.layout === 'panel' ? 'active' : ''}" data-action="plan-layout" data-layout="panel" title="Panel">${icon('grid')} Panel</button>
          <button class="seg-btn ${u.layout === 'lista' ? 'active' : ''}" data-action="plan-layout" data-layout="lista" title="Lista">${icon('list')} Lista</button>
        </div>
        ${isAdmin() ? `<select class="input input-sm" data-change="plan-owner">${options(S.users.map((x) => ({ value: x.id, label: x.name })), u.owner, { empty: 'Todo el equipo' })}</select>` : ''}
        <div class="seg">
          <button class="seg-btn" data-action="plan-nav" data-dir="-1" title="Anterior">${icon('left')}</button>
          <button class="seg-btn" data-action="plan-today">Hoy</button>
          <button class="seg-btn" data-action="plan-nav" data-dir="1" title="Siguiente">${icon('right')}</button>
        </div>
      </div>
    </div>
    ${body}`;
}

export const actions = {
  'plan-mode': (el) => { ui().mode = el.dataset.mode; savePrefs({ planMode: el.dataset.mode }); window.crm.render(); },
  'plan-layout': (el) => { ui().layout = el.dataset.layout; savePrefs({ planLayout: el.dataset.layout }); window.crm.render(); },
  'plan-today': () => { ui().anchor = S.today; window.crm.render(); },
  'plan-nav': (el) => {
    const u = ui();
    const dir = Number(el.dataset.dir);
    const d = parse(u.anchor);
    if (u.mode === 'dia') u.anchor = addDays(u.anchor, dir);
    else if (u.mode === 'semana') u.anchor = addDays(u.anchor, 7 * dir);
    else if (u.mode === 'mes') u.anchor = localISO(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    else u.anchor = localISO(new Date(d.getFullYear() + dir, 0, 1));
    window.crm.render();
  },
  'plan-day': (el, e) => { e.stopPropagation(); Object.assign(ui(), { anchor: el.dataset.date, mode: 'dia' }); window.crm.render(); },
  'plan-month': (el) => { Object.assign(ui(), { anchor: el.dataset.date, mode: 'mes' }); window.crm.render(); },
  'plan-new': (el, e) => {
    if (e.target.closest('.task-chip, .more, .plan-cell-day')) return;
    taskForm(null, { dueDate: el.dataset.date });
  },
};

export const changes = {
  'plan-owner': (el) => { ui().owner = el.value; window.crm.render(); },
};
