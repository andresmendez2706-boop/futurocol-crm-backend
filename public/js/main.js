// Arranque de la aplicación: login, barra lateral, navegación, eventos y sincronización en tiempo real.

import {
  S, api, loadAll, esc, icon, initials, isAdmin, savePrefs, setUnauthorizedHandler,
} from './core.js';
import {
  formModal, toast, showError, allModals, closeAllModals,
} from './ui.js';
import * as panel from './views/panel.js';
import * as companies from './views/companies.js';
import * as contacts from './views/contacts.js';
import * as deals from './views/deals.js';
import * as tasks from './views/tasks.js';
import * as plan from './views/plan.js';
import * as messages from './views/messages.js';
import * as funnel from './views/funnel.js';
import * as reports from './views/reports.js';
import * as audit from './views/audit.js';
import * as settings from './views/settings.js';
import * as users from './views/users.js';
import * as source from './views/source.js';

// Mismo orden de navegación que el CRM original.
const VIEWS = [panel, companies, contacts, deals, tasks, plan, messages, funnel, reports, audit, settings, users, source];
const byId = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

const actions = {};
const changes = {};
const inputs = {};
for (const v of VIEWS) {
  Object.assign(actions, v.actions || {});
  Object.assign(changes, v.changes || {});
  Object.assign(inputs, v.inputs || {});
}

const app = document.getElementById('app');
let current = 'panel';
let renderSeq = 0;

// ------------------------------------------------------------------ login
function renderLogin(message = '') {
  closeAllModals();
  document.body.className = 'is-login';
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-brand">
        <div class="logo-circle logo-lg"><img src="/img/logo.png" alt="Futurocol Academy"></div>
        <h1>Futurocol Academy</h1>
      </div>
      <form class="login-card" id="login-form" novalidate>
        <h2>Iniciar sesión</h2>
        <label class="field full"><span>Correo electrónico</span>
          <input class="input" id="login-email" name="login" type="email" autocomplete="username" required autofocus></label>
        <label class="field full"><span>Contraseña</span>
          <input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" ${message ? '' : 'hidden'}>${esc(message)}</p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
    </div>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/api/auth/login', { login: fd.get('login'), password: fd.get('password') });
      await start();
    } catch (err) {
      const p = form.querySelector('.form-error');
      p.textContent = err.message;
      p.hidden = false;
      btn.disabled = false;
    }
  });
}

setUnauthorizedHandler(() => {
  if (S.me) {
    S.me = null;
    events?.close();
    renderLogin('Tu sesión expiró. Vuelve a iniciar sesión.');
  }
});

// ------------------------------------------------------------------ layout
function renderShell() {
  document.body.className = '';
  const nav = VIEWS.filter((v) => !v.adminOnly || isAdmin())
    .map((v) => `<a href="#/${v.id}" class="nav-item" data-nav="${v.id}">${icon(v.navIcon)}<span>${esc(v.title)}</span></a>`).join('');
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="logo-circle"><img src="/img/logo.png" alt="Futurocol Academy"></div>
        <div class="brand-name">Futurocol Academy CRM</div>
      </div>
      <div class="user-block">
        <div class="avatar">${esc(initials(S.me.name))}</div>
        <div class="user-info">
          <strong>${esc(S.me.name)}</strong>
          <small>${S.me.role === 'admin' ? 'Administrador' : 'Asesor'}</small>
        </div>
        <button class="icon-btn light" data-action="change-password" title="Cambiar contraseña">${icon('key')}</button>
        <button class="icon-btn light" data-action="logout" title="Salir">${icon('logout')}</button>
      </div>
      <div class="global-search">
        ${icon('search')}
        <input id="global-search" class="input" placeholder="Buscar en el CRM…" autocomplete="off" data-input="global-search">
        <div class="search-results" id="search-results" hidden></div>
      </div>
      <nav class="nav">${nav}</nav>
      <div class="live-indicator" id="live-indicator" title="Sincronización en tiempo real"><span></span>En línea</div>
    </aside>
    <div class="content">
      <header class="topbar">
        <button class="icon-btn" data-action="toggle-sidebar" title="Menú">${icon('menu')}</button>
        <span class="topbar-title">Futurocol Academy CRM</span>
      </header>
      <main id="main" class="main"></main>
    </div>`;
}

// ------------------------------------------------------------------ render con preservación de foco/scroll
function captureUi() {
  const a = document.activeElement;
  const main = document.getElementById('main');
  return {
    focusId: a && a.id && main?.contains(a) ? a.id : null,
    sel: a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null,
    mainScroll: main?.scrollTop || 0,
    winScroll: window.scrollY,
    scrolls: [...(main?.querySelectorAll('[data-scroll-key]') || [])].map((el) => [el.dataset.scrollKey, el.scrollTop, el.scrollLeft]),
  };
}
function restoreUi(st) {
  const main = document.getElementById('main');
  for (const [key, top, left] of st.scrolls) {
    const el = main.querySelector(`[data-scroll-key="${CSS.escape(key)}"]`);
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
  main.scrollTop = st.mainScroll;
  window.scrollTo(0, st.winScroll);
  if (st.focusId) {
    const el = document.getElementById(st.focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (st.sel && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(st.sel[0], st.sel[1]); } catch { /* tipo sin selección */ }
      }
    }
  }
}

export async function render() {
  const view = byId[current];
  if (!view || (view.adminOnly && !isAdmin())) {
    location.hash = '#/panel';
    return;
  }
  const main = document.getElementById('main');
  if (!main) return;
  const seq = ++renderSeq;
  const st = captureUi();
  let html;
  try {
    html = await view.render();
  } catch (err) {
    html = `<div class="empty">No se pudo cargar esta sección: ${esc(err.message)}</div>`;
  }
  if (seq !== renderSeq || !document.getElementById('main')) return;
  main.innerHTML = html;
  view.mount?.(main);
  restoreUi(st);
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === current));
  document.title = `${view.title} · Futurocol Academy CRM`;
}

// Recarga los datos del servidor y vuelve a pintar (vista + modales abiertos).
let refreshTimer = null;
let refreshing = false;
export function scheduleRefresh(delay = 250) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}
export async function refresh() {
  if (S.ui.dragging) { scheduleRefresh(600); return; }
  if (refreshing) { scheduleRefresh(300); return; }
  refreshing = true;
  try {
    await loadAll();
    await render();
    for (const m of allModals()) m.onData?.();
  } catch (err) {
    if (err.status !== 401) console.error(err);
  } finally {
    refreshing = false;
  }
}
window.crm = { refresh, render }; // accesible para las vistas sin importaciones circulares

// ------------------------------------------------------------------ tiempo real (SSE)
let events = null;
function connectEvents() {
  events?.close();
  let first = true;
  const indicator = () => document.getElementById('live-indicator');
  events = new EventSource('/api/events');
  events.addEventListener('hello', () => {
    indicator()?.classList.remove('offline');
    if (!first) scheduleRefresh(); // reconexión: puede que nos perdiéramos cambios
    first = false;
  });
  events.addEventListener('change', () => scheduleRefresh());
  events.onerror = () => indicator()?.classList.add('offline');
}

// ------------------------------------------------------------------ eventos delegados
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    if (!e.target.closest('.global-search')) hideSearch();
    return;
  }
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try {
    await fn(el, e);
  } catch (err) {
    showError(err);
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  try { await changes[el.dataset.change]?.(el, e); } catch (err) { showError(err); }
});
document.addEventListener('input', async (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  try { await inputs[el.dataset.input]?.(el, e); } catch (err) { showError(err); }
});

// Período compartido
function setPeriod(patch) {
  S.period = { ...S.period, ...patch };
  if (S.period.type === 'all') S.period = { type: 'all' };
  else {
    const [y, m] = S.today.split('-').map(Number);
    S.period.year ||= y;
    if (S.period.type === 'month') S.period.month ||= m;
    else delete S.period.month;
  }
  savePrefs({ period: S.period });
  render();
}
Object.assign(changes, {
  'period-type': (el) => setPeriod({ type: el.value }),
  'period-month': (el) => setPeriod({ month: Number(el.value) }),
  'period-year': (el) => setPeriod({ year: Number(el.value) }),
});

// Búsqueda global
function hideSearch() {
  const box = document.getElementById('search-results');
  if (box) box.hidden = true;
}
inputs['global-search'] = (el) => {
  const q = el.value.trim().toLowerCase();
  const box = document.getElementById('search-results');
  if (q.length < 2) { box.hidden = true; return; }
  const has = (...vals) => vals.some((v) => v && String(v).toLowerCase().includes(q));
  const qd = q.replace(/\D/g, '');
  const cs = S.contacts.filter((c) => has(c.name, c.email, c.city, c.program) || (qd.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(qd))).slice(0, 6);
  const cos = S.companies.filter((c) => has(c.name, c.nit, c.city, c.domain)).slice(0, 4);
  const ds = S.deals.filter((d) => has(d.title, d.product, d.convocatoria)).slice(0, 5);
  const item = (action, id, title, sub) => `<button class="search-item" data-action="${action}" data-id="${esc(id)}"><strong>${esc(title)}</strong><small>${esc(sub || '')}</small></button>`;
  box.innerHTML = [
    cs.length ? `<div class="search-group">Contactos</div>${cs.map((c) => item('open-contact', c.id, c.name, c.email || c.phone)).join('')}` : '',
    cos.length ? `<div class="search-group">Empresas</div>${cos.map((c) => item('open-company', c.id, c.name, c.city)).join('')}` : '',
    ds.length ? `<div class="search-group">Negocios</div>${ds.map((d) => item('open-deal', d.id, d.title, d.product)).join('')}` : '',
  ].join('') || '<div class="search-empty">Sin resultados</div>';
  box.hidden = false;
};

Object.assign(actions, {
  logout: async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    S.me = null;
    events?.close();
    renderLogin();
  },
  'toggle-sidebar': () => document.body.classList.toggle('sidebar-open'),
  'change-password': () => formModal({
    title: 'Cambiar contraseña',
    size: 'sm',
    fields: [
      { name: 'current', label: 'Contraseña actual', type: 'password', required: true, full: true },
      { name: 'next', label: 'Nueva contraseña (mín. 8 caracteres)', type: 'password', required: true, full: true },
      { name: 'confirm', label: 'Confirmar nueva contraseña', type: 'password', required: true, full: true },
    ],
    onSubmit: async (v) => {
      if (v.next !== v.confirm) throw new Error('Las contraseñas no coinciden');
      await api('POST', '/api/auth/password', { current: v.current, next: v.next });
      toast('Contraseña actualizada');
    },
  }),
});

// ------------------------------------------------------------------ navegación
function onRoute() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'panel';
  current = byId[id] ? id : 'panel';
  document.body.classList.remove('sidebar-open');
  hideSearch();
  render();
}
window.addEventListener('hashchange', () => { if (S.me) onRoute(); });

async function start() {
  await loadAll();
  renderShell();
  connectEvents();
  onRoute();
}

// ------------------------------------------------------------------ inicio
(async () => {
  try {
    await api('GET', '/api/auth/me');
    await start();
  } catch {
    renderLogin();
  }
})();
