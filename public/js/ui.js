// Componentes de interfaz: modales propios (nunca window.confirm/alert/prompt), avisos y formularios.

import {
  esc, icon, options, S, MONTHS, ApiError, isAdmin,
} from './core.js';

const stack = [];
const root = () => document.getElementById('modal-root');

export function openModal({ title, body, footer = '', size = '', onClose, onData } = {}) {
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="icon-btn" data-close title="Cerrar">${icon('close')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  root().appendChild(el);
  document.body.classList.add('has-modal');
  const m = {
    el,
    onData,
    closed: false,
    close(result) {
      if (m.closed) return;
      m.closed = true;
      el.remove();
      stack.splice(stack.indexOf(m), 1);
      if (!stack.length) document.body.classList.remove('has-modal');
      onClose?.(result);
    },
    setBody(html) { el.querySelector('.modal-body').innerHTML = html; },
    setFooter(html) {
      let f = el.querySelector('.modal-foot');
      if (!f) { f = document.createElement('footer'); f.className = 'modal-foot'; el.querySelector('.modal').appendChild(f); }
      f.innerHTML = html;
    },
    query: (sel) => el.querySelector(sel),
  };
  el.addEventListener('mousedown', (e) => { m.downOnBackdrop = e.target === el; });
  el.addEventListener('click', (e) => {
    if ((e.target === el && m.downOnBackdrop) || e.target.closest('[data-close]')) m.close(null);
  });
  stack.push(m);
  // Enfoca el primer campo, salvo que el usuario ya haya puesto el foco dentro del modal.
  setTimeout(() => {
    if (el.contains(document.activeElement)) return;
    el.querySelector('[autofocus], .modal-body input:not([type=hidden]), .modal-body textarea, .modal-body select, .modal-foot .btn-primary')?.focus();
  }, 30);
  return m;
}

export const topModal = () => stack[stack.length - 1];
export const allModals = () => [...stack];
export function closeAllModals() { [...stack].reverse().forEach((m) => m.close(null)); }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) topModal().close(null);
});

// ---- diálogos
export function confirmDialog(message, { title = 'Confirmar', okText = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'sm',
      body: `<p class="dialog-text">${esc(message).replace(/\n/g, '<br>')}</p>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
               <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onClose: (r) => resolve(r === true),
    });
    m.query('[data-ok]').addEventListener('click', () => m.close(true));
    m.query('[data-ok]').focus();
  });
}

export function alertDialog(message, { title = 'Aviso' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'sm',
      body: `<p class="dialog-text">${esc(message).replace(/\n/g, '<br>')}</p>`,
      footer: '<button type="button" class="btn btn-primary" data-close>Entendido</button>',
      onClose: () => resolve(),
    });
    m.query('.modal-foot .btn').focus();
  });
}

export function promptDialog(message, {
  title = 'Ingresa un valor', value = '', placeholder = '', required = true, multiline = false, okText = 'Aceptar', choices,
} = {}) {
  return new Promise((resolve) => {
    const input = multiline
      ? `<textarea class="input" rows="3" data-prompt placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" data-prompt value="${esc(value)}" placeholder="${esc(placeholder)}" ${choices ? 'list="prompt-choices"' : ''}>`;
    const m = openModal({
      title,
      size: 'sm',
      body: `<form data-prompt-form><label class="field full"><span>${esc(message)}</span>${input}</label>
        ${choices ? `<datalist id="prompt-choices">${choices.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>` : ''}
        <p class="form-error" hidden></p></form>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
               <button type="button" class="btn btn-primary" data-ok>${esc(okText)}</button>`,
      onClose: (r) => resolve(r === null || r === undefined ? null : r),
    });
    const field = m.query('[data-prompt]');
    const submit = () => {
      const v = field.value.trim();
      if (required && !v) {
        const err = m.query('.form-error');
        err.textContent = 'Este campo es obligatorio.';
        err.hidden = false;
        field.focus();
        return;
      }
      m.close(v);
    };
    m.query('[data-ok]').addEventListener('click', submit);
    m.query('[data-prompt-form]').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    if (multiline) field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });
    setTimeout(() => { if (document.activeElement !== field) field.focus(); }, 40);
  });
}

// ---- avisos breves
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 2800);
}

export function showError(err) {
  const msg = err instanceof ApiError || err instanceof Error ? err.message : String(err);
  toast(msg, 'error');
}

// ---- formularios
export function fieldHtml(f) {
  const id = `f_${f.name}`;
  const req = f.required ? ' required' : '';
  const common = `id="${id}" name="${esc(f.name)}"${req}${f.disabled ? ' disabled' : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}`;
  let control;
  switch (f.type) {
    case 'select':
      control = `<select class="input" ${common}>${options(f.options || [], f.value, { empty: f.empty })}</select>`;
      break;
    case 'textarea':
      control = `<textarea class="input" rows="${f.rows || 3}" ${common}>${esc(f.value ?? '')}</textarea>`;
      break;
    case 'checkbox':
      control = `<input type="checkbox" ${common}${f.value ? ' checked' : ''}>`;
      break;
    default:
      control = `<input class="input" type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.step ? ` step="${f.step}"` : ''}${f.list ? ` list="${f.list}"` : ''}>`;
  }
  return `<label class="field${f.full ? ' full' : ''}${f.type === 'checkbox' ? ' check' : ''}" for="${id}">
    <span>${esc(f.label)}${f.required ? ' <b class="req">*</b>' : ''}</span>${control}
    ${f.hint ? `<small class="hint">${f.hint}</small>` : ''}</label>`;
}

export const fieldsHtml = (fields) => `<div class="form-grid">${fields.filter(Boolean).map((f) => (typeof f === 'string' ? f : fieldHtml(f))).join('')}</div>`;

export function readForm(el) {
  const out = {};
  el.querySelectorAll('[name]').forEach((i) => {
    if (i.disabled) return;
    out[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  });
  return out;
}

/**
 * Formulario en modal. onSubmit(values) puede lanzar un error: se muestra dentro del modal.
 * Si onSubmit devuelve false, el modal no se cierra.
 */
export function formModal({ title, fields, submitText = 'Guardar', onSubmit, size = '', extraBody = '' }) {
  const m = openModal({
    title,
    size,
    body: `<form data-form novalidate>${fieldsHtml(fields)}${extraBody}<p class="form-error" hidden></p><button type="submit" hidden></button></form>`,
    footer: `<button type="button" class="btn" data-close>Cancelar</button>
             <button type="button" class="btn btn-primary" data-submit>${esc(submitText)}</button>`,
  });
  const form = m.query('[data-form]');
  const err = m.query('.form-error');
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const missing = [...form.querySelectorAll('[required]')].find((i) => !String(i.value).trim());
    if (missing) {
      err.textContent = `Completa el campo "${missing.closest('.field')?.querySelector('span')?.textContent.replace('*', '').trim()}".`;
      err.hidden = false;
      missing.focus();
      return;
    }
    busy = true;
    m.query('[data-submit]').disabled = true;
    try {
      const r = await onSubmit(readForm(form), m);
      if (r !== false) m.close(true);
    } catch (e) {
      err.textContent = e.message || 'No se pudo guardar';
      err.hidden = false;
    } finally {
      busy = false;
      if (!m.closed) m.query('[data-submit]').disabled = false;
    }
  };
  m.query('[data-submit]').addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  return m;
}

// ---- selector de período (sincronizado entre Panel, Negocios, Reportes y Embudo)
export function periodPicker() {
  const p = S.period;
  const [curY] = S.today.split('-').map(Number);
  const years = [];
  for (let y = curY + 1; y >= curY - 6; y--) years.push(y);
  return `<div class="period-picker" title="Período">
    <select class="input input-sm" data-change="period-type">
      ${options([{ value: 'month', label: 'Mes' }, { value: 'year', label: 'Año' }, { value: 'all', label: 'General' }], p.type)}
    </select>
    ${p.type === 'month' ? `<select class="input input-sm" data-change="period-month">${options(MONTHS.map((m, i) => ({ value: i + 1, label: m })), p.month)}</select>` : ''}
    ${p.type !== 'all' ? `<select class="input input-sm" data-change="period-year">${options(years, p.year)}</select>` : ''}
  </div>`;
}

export const emptyState = (text) => `<div class="empty">${esc(text)}</div>`;

// Campo "Responsable": solo el admin puede asignar registros a otros usuarios.
export const assigneeField = (value) => (isAdmin() ? {
  name: 'assignedTo', label: 'Responsable', type: 'select', value: value || S.me.id,
  options: S.users.map((u) => ({ value: u.id, label: `${u.name}${u.role === 'admin' ? ' (admin)' : ''}` })),
} : null);
