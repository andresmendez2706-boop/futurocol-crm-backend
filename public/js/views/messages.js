import {
  S, api, esc, icon, initials, fmtDateTime, userById,
} from '../core.js';
import { emptyState, toast } from '../ui.js';

export const id = 'mensajes';
export const title = 'Mensajes';
export const navIcon = 'mensajes';

const ui = () => (S.ui.messages ||= { with: null, draft: '' });

const mailto = (user, text) => `mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent(`Mensaje de ${S.me.name} · Futurocol CRM`)}&body=${encodeURIComponent(text)}`;

export function render() {
  const u = ui();
  const others = S.users.filter((x) => x.id !== S.me.id);
  const last = (uid) => S.messages.filter((m) => m.from === uid || m.to === uid).at(-1);
  // Conversaciones con usuarios eliminados también se conservan.
  const ghostIds = [...new Set(S.messages.flatMap((m) => [m.from, m.to]))].filter((x) => x !== S.me.id && !userById(x));
  const people = [...others, ...ghostIds.map((gid) => ({ id: gid, name: 'Usuario eliminado', email: '', role: '' }))]
    .sort((a, b) => new Date(last(b.id)?.at || 0) - new Date(last(a.id)?.at || 0));
  if (!u.with && people.length) u.with = people[0].id;
  const other = people.find((p) => p.id === u.with);
  const thread = S.messages.filter((m) => (m.from === u.with && m.to === S.me.id) || (m.to === u.with && m.from === S.me.id));
  return `
    <div class="page-head"><div><h1>Mensajes</h1><p class="muted">Mensajería interna del equipo</p></div></div>
    <div class="chat">
      <aside class="chat-list">${people.map((p) => {
        const lm = last(p.id);
        return `<button class="chat-person ${p.id === u.with ? 'active' : ''}" data-action="chat-with" data-id="${esc(p.id)}">
          <div class="avatar sm">${esc(initials(p.name))}</div>
          <div><strong>${esc(p.name)}</strong><small class="block muted">${esc(lm ? lm.text.slice(0, 40) : p.role === 'admin' ? 'Administrador' : p.role ? 'Asesor' : '')}</small></div>
        </button>`;
      }).join('') || emptyState('No hay otros usuarios.')}</aside>
      <section class="chat-thread">
        ${other ? `
          <header class="chat-head"><strong>${esc(other.name)}</strong>${other.email ? `<small class="muted">${esc(other.email)}</small>` : ''}</header>
          <div class="chat-messages" data-scroll-key="chat-${esc(other.id)}" id="chat-messages">
            ${thread.map((m) => `<div class="msg ${m.from === S.me.id ? 'mine' : ''}">
              <p>${esc(m.text).replace(/\n/g, '<br>')}</p>
              <small>${fmtDateTime(m.at)}${m.from === S.me.id && other.email ? ` · <a href="${esc(mailto(other, m.text))}" title="Enviar también por correo">${icon('mail', 'ico-sm')} correo</a>` : ''}</small>
            </div>`).join('') || '<p class="muted center">Aún no hay mensajes. ¡Escribe el primero!</p>'}
          </div>
          ${userById(other.id) ? `<div class="chat-compose">
            <textarea id="chat-draft" class="input" rows="2" placeholder="Escribe un mensaje…" data-input="chat-draft">${esc(u.draft)}</textarea>
            <div class="chat-actions">
              <button class="btn btn-primary" data-action="chat-send">Enviar</button>
              ${other.email ? `<button class="btn" data-action="chat-send-mail" title="Envía el mensaje en el CRM y abre tu correo para mandarlo a ${esc(other.email)}">${icon('mail')} Enviar + correo</button>` : ''}
            </div>
          </div>` : '<p class="note">Este usuario fue eliminado; la conversación se conserva como historial.</p>'}`
    : emptyState('Selecciona una conversación.')}
      </section>
    </div>`;
}

export function mount(root) {
  const box = root.querySelector('#chat-messages');
  if (box && !S.ui.messages.keepScroll) box.scrollTop = box.scrollHeight;
  S.ui.messages.keepScroll = false;
  root.querySelector('#chat-draft')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(false); }
  });
}

async function send(alsoMail) {
  const u = ui();
  const text = u.draft.trim();
  if (!text || !u.with) return;
  await api('POST', '/api/messages', { to: u.with, text });
  u.draft = '';
  const el = document.getElementById('chat-draft');
  if (el) el.value = '';
  if (alsoMail) {
    const other = userById(u.with);
    if (other?.email) window.location.href = mailto(other, text);
  }
  toast('Mensaje enviado');
  await window.crm.refresh();
}

export const actions = {
  'chat-with': (el) => { Object.assign(ui(), { with: el.dataset.id, draft: '' }); window.crm.render(); },
  'chat-send': () => send(false),
  'chat-send-mail': () => send(true),
};

export const inputs = {
  'chat-draft': (el) => { ui().draft = el.value; },
};
