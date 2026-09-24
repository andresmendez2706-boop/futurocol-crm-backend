// Estado global, acceso a la API y utilidades compartidas por todas las vistas.

export const S = {
  me: null,
  users: [],
  companies: [],
  contacts: [],
  deals: [],
  tasks: [],
  messages: [],
  settings: { stages: [], commissions: {} },
  constants: {},
  today: null,
  period: null,
  ui: {}, // estado de cada vista (búsquedas, filtros, modos)
};

// ---------------------------------------------------------------- API
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Error ${status}`);
    this.status = status;
    this.body = body || {};
    this.code = body?.code;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(method, url, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/api/auth/login')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, isJson ? data : { error: data });
  return data;
}

export async function loadAll() {
  const data = await api('GET', '/api/bootstrap');
  Object.assign(S, {
    me: data.me, users: data.users, companies: data.companies, contacts: data.contacts, deals: data.deals,
    tasks: data.tasks, messages: data.messages, settings: data.settings, constants: data.constants, today: data.today,
  });
  if (!S.period) S.period = data.me.prefs?.period || defaultPeriod();
  S.version = (S.version || 0) + 1;
  return data;
}

// Estadísticas del panel (cacheadas por período y versión de datos para no pedirlas en cada tecla).
const statsCache = {};
export async function cachedDashboard() {
  const key = `${periodQuery()}|${S.version}`;
  if (!statsCache[key]) {
    for (const k of Object.keys(statsCache)) delete statsCache[k];
    statsCache[key] = api('GET', `/api/stats/dashboard?${periodQuery()}`).catch((e) => { delete statsCache[key]; throw e; });
  }
  return statsCache[key];
}

// Preferencias del usuario guardadas en el servidor (se sincronizan entre dispositivos).
let prefsTimer = null;
const pendingPrefs = {};
export function savePrefs(patch) {
  Object.assign(pendingPrefs, patch);
  S.me.prefs = { ...(S.me.prefs || {}), ...patch };
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    const body = { ...pendingPrefs };
    for (const k of Object.keys(pendingPrefs)) delete pendingPrefs[k];
    api('PATCH', '/api/me/prefs', body).catch(() => {});
  }, 400);
}

// ---------------------------------------------------------------- permisos (espejo de la API)
export const isAdmin = () => S.me?.role === 'admin';
export const canManage = (record) => !!record && (isAdmin() || record.assignedTo === S.me.id);
export const canEditTask = (task) => !!task && task.assignedTo === S.me.id;

// ---------------------------------------------------------------- formato
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const money = (n) => moneyFmt.format(Number(n) || 0);
export const compactMoney = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1).replace('.0', '')} mil M`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1).replace('.0', '')} M`;
  return money(v);
};
export const pct = (n) => `${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;

export const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function fmtDate(v) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localISO(new Date(y, m - 1, d + n));
};
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---------------------------------------------------------------- catálogos
export const userById = (id) => S.users.find((u) => u.id === id);
export const userName = (id) => userById(id)?.name || (id ? 'Usuario eliminado' : '—');
export const contactById = (id) => S.contacts.find((c) => c.id === id);
export const companyById = (id) => S.companies.find((c) => c.id === id);
export const dealById = (id) => S.deals.find((d) => d.id === id);
export const taskById = (id) => S.tasks.find((t) => t.id === id);
export const stageById = (id) => S.settings.stages.find((s) => s.id === id);
export const stageLabel = (id) => stageById(id)?.label || id || '—';
export const WON = 'ganado';
export const LOST = 'perdido';
export const isClosedStage = (id) => (S.constants.closedStages || ['ganado', 'perdido', 'aplazado']).includes(id);

export const TASK_TYPE_LABELS = {
  llamada: 'Llamada', concertacion: 'Concertación', entrevista: 'Entrevista', reunion: 'Reunión',
  documentos: 'Documentos', propuesta: 'Propuesta', matricula: 'Matrícula', otro: 'Otro',
};
export const ACTIVITY_LABELS = {
  nota: 'Nota', llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', reunion: 'Reunión',
  videollamada: 'Videollamada', visita: 'Visita', seguimiento: 'Seguimiento', propuesta: 'Propuesta',
};

export function dealProbability(d) {
  if (d.probability !== null && d.probability !== undefined) return Number(d.probability);
  return Number(stageById(d.stage)?.probability ?? 0);
}

// Semáforo: rojo = vencida; amarillo = vence hoy o mañana; verde = completada o más adelante.
export function taskLight(t) {
  if (t.done || !t.dueDate) return 'verde';
  if (t.dueDate < S.today) return 'rojo';
  if (t.dueDate <= addDays(S.today, 1)) return 'amarillo';
  return 'verde';
}
export const lightDot = (t) => {
  const l = taskLight(t);
  const title = { rojo: 'Vencida', amarillo: 'Vence hoy o mañana', verde: t.done ? 'Completada' : 'A tiempo' }[l];
  return `<span class="dot dot-${l}" title="${title}"></span>`;
};

// ---------------------------------------------------------------- período (compartido Panel/Negocios/Reportes)
export function defaultPeriod() {
  const [y, m] = (S.today || localISO(new Date())).split('-').map(Number);
  return { type: 'month', year: y, month: m };
}
export const periodQuery = (p = S.period) => new URLSearchParams(
  Object.fromEntries(Object.entries({ type: p.type, year: p.year, month: p.month }).filter(([, v]) => v !== undefined)),
).toString();
export function periodLabel(p = S.period) {
  if (p.type === 'month') return `${MONTHS[p.month - 1]} ${p.year}`;
  if (p.type === 'year') return `Año ${p.year}`;
  return 'General (todo el tiempo)';
}
export function inPeriod(iso, p = S.period) {
  if (p.type === 'all') return true;
  if (!iso) return false;
  const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
  return p.type === 'year' ? y === p.year : y === p.year && m === p.month;
}
export function billingDate(d) {
  if (d.closeDate) return d.closeDate;
  const h = [...(d.stageHistory || [])].reverse().find((x) => x.stage === WON);
  return h?.at ? localISO(new Date(h.at)) : (d.createdAt ? localISO(new Date(d.createdAt)) : null);
}

export function effectiveRate(u) {
  if (u.commissionRate !== null && u.commissionRate !== undefined) return Number(u.commissionRate);
  const c = S.settings.commissions || {};
  return Number(u.role === 'admin' ? c.adminDefault : c.asesorDefault) || 0;
}

// ---------------------------------------------------------------- iconos (SVG en línea)
const ICONS = {
  panel: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  empresas: 'M3 21V7l9-4 9 4v14h-6v-6H9v6H3zm4-10h2V9H7v2zm4 0h2V9h-2v2zm4 0h2V9h-2v2z',
  contactos: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h7v-2.5c0-.9.4-1.8 1.1-2.5A10 10 0 0 0 8 13zm8 0c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  negocios: 'M20 6h-4V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM10 4h4v2h-4V4z',
  tareas: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  plan: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z',
  mensajes: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z',
  embudo: 'M3 4h18l-7 9v6l-4 2v-8L3 4z',
  reportes: 'M5 9h3v11H5V9zm5.5-5h3v16h-3V4zM16 13h3v7h-3v-7z',
  auditoria: 'M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm-1 16-4-4 1.4-1.4L11 14.2l5.6-5.6L18 10l-7 7z',
  configuracion: 'M19.4 13a7.8 7.8 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.8 7.8 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  usuarios: 'M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z',
  codigo: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  logout: 'M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5z',
  key: 'M12.6 10A6 6 0 1 0 7 18a6 6 0 0 0 5.6-4H17v4h4v-4h2v-4H12.6zM7 14a2 2 0 1 1 2-2 2 2 0 0 1-2 2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  edit: 'M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  mail: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  upload: 'M5 20h14v-2H5v2zM9 16h6v-6h4l-7-7-7 7h4v6z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  up: 'M7 14l5-5 5 5H7z',
  down: 'M7 10l5 5 5-5H7z',
  left: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  right: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  grid: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  columns: 'M3 3h5v18H3V3zm6.5 0h5v18h-5V3zM16 3h5v18h-5V3z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6z',
  whatsapp: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z',
};
export const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

// ---------------------------------------------------------------- opciones de <select>
export const options = (list, selected, { empty } = {}) => {
  const items = list.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '')
    + items.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
};
export const userOptions = (selected, filter = () => true) => options(
  S.users.filter(filter).map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })), selected,
);
