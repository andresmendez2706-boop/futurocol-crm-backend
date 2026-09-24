import {
  S, api, esc, icon, isAdmin, canManage, canEditTask, userName, companyById, contactById, money, fmtDate, fmtDateTime,
  stageLabel, options, MONTHS, ACTIVITY_LABELS, TASK_TYPE_LABELS, lightDot, initials, savePrefs,
} from '../core.js';
import {
  formModal, openModal, confirmDialog, alertDialog, toast, emptyState, assigneeField,
} from '../ui.js';
import { taskForm } from './tasks.js';
import { dealForm } from './deals.js';

export const id = 'contactos';
export const title = 'Contactos';
export const navIcon = 'contactos';

const ui = () => (S.ui.contacts ||= { q: '', year: '', month: '', layout: S.me.prefs?.contactsLayout || 'lista' });

function filtered() {
  const { q, year, month } = ui();
  const t = q.trim().toLowerCase();
  const qd = t.replace(/\D/g, '');
  return S.contacts.filter((c) => {
    if (year || month) {
      const d = new Date(c.createdAt);
      if (year && d.getFullYear() !== Number(year)) return false;
      if (month && d.getMonth() + 1 !== Number(month)) return false;
    }
    if (!t) return true;
    const company = companyById(c.companyId)?.name;
    return [c.name, c.email, c.city, c.program, company, c.notes].some((v) => v && v.toLowerCase().includes(t))
      || (qd.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(qd));
  });
}

const waLink = (phone) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = `57${d}`;
  return d ? `https://wa.me/${d}` : null;
};

export function render() {
  const u = ui();
  const list = filtered();
  const years = [...new Set(S.contacts.map((c) => new Date(c.createdAt).getFullYear()))].sort((a, b) => b - a);
  const body = !list.length ? emptyState('No hay contactos que coincidan.') : u.layout === 'panel'
    ? `<div class="cards-grid">${list.map((c) => `
        <div class="contact-card clickable" data-action="open-contact" data-id="${esc(c.id)}">
          <div class="contact-card-head"><div class="avatar sm">${esc(initials(c.name))}</div>
            <div><strong>${esc(c.name)}</strong><small class="block muted">${esc(companyById(c.companyId)?.name || c.city || '')}</small></div></div>
          <div class="contact-card-body">
            ${c.program ? `<span class="chip">${esc(c.program)}</span>` : ''}
            <small class="block">${esc(c.phone || '')}</small><small class="block">${esc(c.email || '')}</small>
          </div>
          <small class="muted">${esc(userName(c.assignedTo))} · ${fmtDate(c.createdAt)}</small>
        </div>`).join('')}</div>`
    : `<div class="card no-pad"><div class="table-wrap"><table class="table">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Empresa</th><th>Programa</th><th>Ciudad</th><th>Responsable</th><th>Creado</th><th></th></tr></thead>
        <tbody>${list.map((c) => `<tr class="clickable" data-action="open-contact" data-id="${esc(c.id)}">
          <td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td>
          <td>${esc(companyById(c.companyId)?.name || '—')}</td><td>${esc(c.program || '—')}</td><td>${esc(c.city || '—')}</td>
          <td>${esc(userName(c.assignedTo))}</td><td>${fmtDate(c.createdAt)}</td>
          <td class="actions">${canManage(c) ? `<button class="icon-btn" data-action="edit-contact" data-id="${esc(c.id)}" title="Editar">${icon('edit')}</button>` : ''}
          ${isAdmin() ? `<button class="icon-btn danger" data-action="delete-contact" data-id="${esc(c.id)}" title="Eliminar">${icon('trash')}</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div></div>`;
  return `
    <div class="page-head">
      <div><h1>Contactos</h1><p class="muted">${list.length} de ${S.contacts.length} contacto(s)</p></div>
      <div class="toolbar">
        <input id="contacts-q" class="input" placeholder="Buscar nombre, teléfono, correo…" value="${esc(u.q)}" data-input="contacts-q">
        <select class="input input-sm" data-change="contacts-month" title="Mes de creación">${options(MONTHS.map((m, i) => ({ value: i + 1, label: m })), u.month, { empty: 'Todos los meses' })}</select>
        <select class="input input-sm" data-change="contacts-year" title="Año de creación">${options(years, u.year, { empty: 'Todos los años' })}</select>
        <div class="seg">
          <button class="seg-btn ${u.layout === 'lista' ? 'active' : ''}" data-action="contacts-layout" data-layout="lista" title="Lista">${icon('list')}</button>
          <button class="seg-btn ${u.layout === 'panel' ? 'active' : ''}" data-action="contacts-layout" data-layout="panel" title="Panel">${icon('grid')}</button>
        </div>
        ${isAdmin() ? `<a class="btn" href="/api/contacts/export.csv" download>${icon('download')} Exportar</a>
          <label class="btn">${icon('upload')} Importar<input type="file" accept=".csv,text/csv" hidden data-change="contacts-import"></label>` : ''}
        <button class="btn btn-primary" data-action="new-contact">${icon('plus')} Nuevo contacto</button>
      </div>
    </div>
    ${body}`;
}

// ---------------------------------------------------------------- formulario (con detección de duplicados)
export function contactForm(contact = null, { companyId, onSaved } = {}) {
  const c = contact || {};
  const companies = S.companies.filter((x) => canManage(x) || x.id === c.companyId);
  formModal({
    title: contact ? 'Editar contacto' : 'Nuevo contacto',
    size: 'lg',
    fields: [
      { name: 'name', label: 'Nombre completo', value: c.name, required: true },
      { name: 'phone', label: 'Teléfono', value: c.phone, type: 'tel' },
      { name: 'email', label: 'Correo', value: c.email, type: 'email' },
      { name: 'companyId', label: 'Empresa', type: 'select', value: c.companyId || companyId, empty: 'Sin empresa', options: companies.map((x) => ({ value: x.id, label: x.name })) },
      { name: 'program', label: 'Programa de interés', type: 'select', value: c.program, empty: 'Sin programa', options: S.constants.programs },
      { name: 'city', label: 'Ciudad', value: c.city },
      assigneeField(c.assignedTo),
      { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes, full: true },
    ],
    onSubmit: async (v) => {
      if (v.email || v.phone) {
        const { duplicates } = await api('POST', '/api/contacts/check-duplicates', { email: v.email, phone: v.phone, excludeId: contact?.id });
        if (duplicates.length) {
          const lines = duplicates.map((d) => `• ${d.name}${d.email ? ` (${d.email})` : ''}${d.phone ? ` ${d.phone}` : ''} — coincide por ${d.match}, responsable: ${d.owner}`).join('\n');
          const go = await confirmDialog(`Posible contacto duplicado:\n${lines}\n\n¿Deseas guardarlo de todas formas?`, { title: 'Posible duplicado', okText: 'Guardar de todas formas' });
          if (!go) return false;
        }
      }
      const saved = contact ? await api('PATCH', `/api/contacts/${contact.id}`, v) : await api('POST', '/api/contacts', v);
      toast(contact ? 'Contacto actualizado' : 'Contacto creado');
      await window.crm.refresh();
      onSaved?.(saved);
    },
  });
}

// ---------------------------------------------------------------- detalle
function detailHtml(c) {
  const company = companyById(c.companyId);
  const tasks = S.tasks.filter((t) => t.contactId === c.id).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const deals = S.deals.filter((d) => d.contactId === c.id);
  const activity = [...(c.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const manage = canManage(c);
  const wa = waLink(c.phone);
  return `
    <div class="detail-head">
      <div class="avatar">${esc(initials(c.name))}</div>
      <div>
        <div class="quick-links">
          ${c.phone ? `<a class="chip" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}
          ${wa ? `<a class="chip" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${c.email ? `<a class="chip" href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>` : ''}
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div><small>Empresa</small><span>${company ? `<a href="#" data-action="open-company" data-id="${esc(company.id)}">${esc(company.name)}</a>` : '—'}</span></div>
      <div><small>Programa</small><span>${esc(c.program || '—')}</span></div>
      <div><small>Ciudad</small><span>${esc(c.city || '—')}</span></div>
      <div><small>Responsable</small><span>${esc(userName(c.assignedTo))}</span></div>
      <div><small>Creado</small><span>${fmtDateTime(c.createdAt)}</span></div>
    </div>
    ${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : ''}

    <div class="detail-columns">
      <section>
        <h4>Bitácora de actividades</h4>
        ${manage ? `<div class="activity-form">
          <select class="input input-sm" id="act-type">${options(S.constants.activityTypes.map((t) => ({ value: t, label: ACTIVITY_LABELS[t] || t })), 'llamada')}</select>
          <textarea class="input" id="act-text" rows="2" placeholder="¿Qué pasó en esta gestión?"></textarea>
          <button class="btn btn-primary btn-sm" data-action="add-activity" data-id="${esc(c.id)}">Registrar</button>
        </div>` : ''}
        ${activity.length ? `<ul class="timeline">${activity.map((a) => `<li>
          <span class="chip chip-${esc(a.type)}">${esc(ACTIVITY_LABELS[a.type] || a.type)}</span>
          <p>${esc(a.text)}</p><small>${esc(a.author || '')} · ${fmtDateTime(a.at)}</small></li>`).join('')}</ul>`
          : '<p class="muted">Sin actividades registradas.</p>'}
      </section>
      <section>
        <div class="section-head"><h4>Tareas (${tasks.length})</h4>${manage ? `<button class="btn btn-sm" data-action="contact-new-task" data-id="${esc(c.id)}">${icon('plus')} Tarea</button>` : ''}</div>
        ${tasks.length ? `<ul class="mini-list">${tasks.map((t) => `<li class="${t.done ? 'done' : ''}">
          ${lightDot(t)}
          ${canEditTask(t) ? `<input type="checkbox" data-change="toggle-task" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} title="Completada">` : ''}
          <a href="#" data-action="open-task" data-id="${esc(t.id)}">${esc(t.title)}</a>
          <small>${esc(TASK_TYPE_LABELS[t.type] || t.type)} · ${fmtDate(t.dueDate)}${t.contactTime ? ` ${esc(t.contactTime)}` : ''}</small></li>`).join('')}</ul>`
          : '<p class="muted">Sin tareas.</p>'}
        <div class="section-head"><h4>Negocios (${deals.length})</h4>${manage ? `<button class="btn btn-sm" data-action="contact-new-deal" data-id="${esc(c.id)}">${icon('plus')} Negocio</button>` : ''}</div>
        ${deals.length ? `<ul class="mini-list">${deals.map((d) => `<li><a href="#" data-action="open-deal" data-id="${esc(d.id)}">${esc(d.title)}</a>
          <small>${esc(stageLabel(d.stage))} · ${money(d.value)}</small></li>`).join('')}</ul>` : '<p class="muted">Sin negocios.</p>'}
      </section>
    </div>`;
}

export function openContact(contactId) {
  const c = contactById(contactId);
  if (!c) return;
  const footer = () => {
    const cur = contactById(contactId);
    return `${isAdmin() ? `<button class="btn btn-danger-ghost" data-action="delete-contact" data-id="${esc(contactId)}">${icon('trash')} Eliminar</button>` : ''}
      <span class="spacer"></span>
      ${cur && canManage(cur) ? `<button class="btn btn-primary" data-action="edit-contact" data-id="${esc(contactId)}">${icon('edit')} Editar</button>` : ''}`;
  };
  const m = openModal({
    title: c.name,
    size: 'xl',
    body: detailHtml(c),
    footer: footer(),
    onData: () => {
      const cur = contactById(contactId);
      if (!cur) { m.close(); return; }
      // Conserva lo que el usuario esté escribiendo en la bitácora.
      const draft = m.query('#act-text')?.value;
      const type = m.query('#act-type')?.value;
      m.setBody(detailHtml(cur));
      m.setFooter(footer());
      if (draft && m.query('#act-text')) m.query('#act-text').value = draft;
      if (type && m.query('#act-type')) m.query('#act-type').value = type;
    },
  });
}

export const actions = {
  'new-contact': () => contactForm(),
  'open-contact': (el) => openContact(el.dataset.id),
  'edit-contact': (el) => contactForm(contactById(el.dataset.id)),
  'delete-contact': async (el) => {
    const c = contactById(el.dataset.id);
    if (!c) return;
    const nt = S.tasks.filter((t) => t.contactId === c.id).length;
    const nd = S.deals.filter((d) => d.contactId === c.id).length;
    const ok = await confirmDialog(
      `¿Eliminar el contacto "${c.name}"?${nt ? `\nSe eliminarán también sus ${nt} tarea(s).` : ''}${nd ? `\nSus ${nd} negocio(s) se conservarán sin contacto.` : ''}`,
      { title: 'Eliminar contacto', okText: 'Eliminar', danger: true },
    );
    if (!ok) return;
    await api('DELETE', `/api/contacts/${c.id}`);
    toast('Contacto eliminado');
    await window.crm.refresh();
  },
  'contacts-layout': (el) => {
    ui().layout = el.dataset.layout;
    savePrefs({ contactsLayout: el.dataset.layout });
    window.crm.render();
  },
  'add-activity': async (el) => {
    const modal = el.closest('.modal');
    const text = modal.querySelector('#act-text').value.trim();
    const type = modal.querySelector('#act-type').value;
    if (!text) { await alertDialog('Escribe el detalle de la actividad.'); return; }
    el.disabled = true;
    await api('POST', `/api/contacts/${el.dataset.id}/activity`, { type, text });
    modal.querySelector('#act-text').value = '';
    toast('Actividad registrada');
    await window.crm.refresh();
  },
  'contact-new-task': (el) => taskForm(null, { contactId: el.dataset.id }),
  'contact-new-deal': (el) => dealForm(null, { contactId: el.dataset.id }),
};

export const inputs = {
  'contacts-q': (el) => { ui().q = el.value; window.crm.render(); },
};

export const changes = {
  'contacts-month': (el) => { ui().month = el.value; window.crm.render(); },
  'contacts-year': (el) => { ui().year = el.value; window.crm.render(); },
  'contacts-import': async (el) => {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    const csv = await file.text();
    const ok = await confirmDialog(`¿Importar contactos desde "${file.name}"?\nColumnas reconocidas: nombre, telefono, email, empresa, programa, ciudad, notas, responsable (correo del usuario).`, { title: 'Importar CSV', okText: 'Importar' });
    if (!ok) return;
    const r = await api('POST', '/api/contacts/import', { csv });
    await window.crm.refresh();
    await alertDialog(`Importación terminada: ${r.created} creados, ${r.skipped} omitidos.${r.errors.length ? `\n\n${r.errors.slice(0, 10).join('\n')}` : ''}`, { title: 'Importar CSV' });
  },
};
