import {
  S, api, esc, icon, isAdmin, canManage, userName, companyById, money, fmtDate, stageLabel,
} from '../core.js';
import {
  formModal, openModal, confirmDialog, toast, emptyState, assigneeField,
} from '../ui.js';

export const id = 'empresas';
export const title = 'Empresas';
export const navIcon = 'empresas';

const ui = () => (S.ui.companies ||= { q: '' });

function filtered() {
  const q = ui().q.trim().toLowerCase();
  return S.companies.filter((c) => !q || [c.name, c.nit, c.city, c.sector, c.domain, c.email].some((v) => v && v.toLowerCase().includes(q)));
}

export function render() {
  const list = filtered();
  const rows = list.map((c) => {
    const nContacts = S.contacts.filter((x) => x.companyId === c.id).length;
    const nDeals = S.deals.filter((d) => S.contacts.some((x) => x.companyId === c.id && x.id === d.contactId)).length;
    return `<tr class="clickable" data-action="open-company" data-id="${esc(c.id)}">
      <td><strong>${esc(c.name)}</strong><small class="block muted">${esc(c.domain || '')}</small></td>
      <td>${esc(c.nit || '—')}</td><td>${esc(c.city || '—')}</td><td>${esc(c.sector || '—')}</td>
      <td class="num">${nContacts}</td><td class="num">${nDeals}</td><td>${esc(userName(c.assignedTo))}</td>
      <td class="actions">${canManage(c) ? `<button class="icon-btn" data-action="edit-company" data-id="${esc(c.id)}" title="Editar">${icon('edit')}</button>` : ''}
        ${isAdmin() ? `<button class="icon-btn danger" data-action="delete-company" data-id="${esc(c.id)}" title="Eliminar">${icon('trash')}</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="page-head">
      <div><h1>Empresas</h1><p class="muted">${list.length} empresa(s)</p></div>
      <div class="toolbar">
        <input id="companies-q" class="input" placeholder="Buscar empresa, NIT, ciudad…" value="${esc(ui().q)}" data-input="companies-q">
        <button class="btn btn-primary" data-action="new-company">${icon('plus')} Nueva empresa</button>
      </div>
    </div>
    <div class="card no-pad">
      ${list.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Empresa</th><th>NIT</th><th>Ciudad</th><th>Sector</th><th class="num">Contactos</th><th class="num">Negocios</th><th>Responsable</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : emptyState('No hay empresas que coincidan.')}
    </div>`;
}

export function companyForm(company = null, { onSaved } = {}) {
  const c = company || {};
  formModal({
    title: company ? 'Editar empresa' : 'Nueva empresa',
    size: 'lg',
    fields: [
      { name: 'name', label: 'Nombre / razón social', value: c.name, required: true },
      { name: 'nit', label: 'NIT', value: c.nit },
      { name: 'domain', label: 'Dominio / sitio web', value: c.domain },
      { name: 'phone', label: 'Teléfono', value: c.phone },
      { name: 'email', label: 'Correo', type: 'email', value: c.email },
      { name: 'address', label: 'Dirección', value: c.address },
      { name: 'city', label: 'Ciudad', value: c.city },
      { name: 'department', label: 'Departamento', value: c.department },
      { name: 'country', label: 'País', value: c.country ?? (company ? '' : 'Colombia') },
      { name: 'sector', label: 'Sector', value: c.sector },
      { name: 'employees', label: 'Empleados', value: c.employees },
      { name: 'source', label: 'Fuente', value: c.source },
      assigneeField(c.assignedTo),
      { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes, full: true },
    ],
    onSubmit: async (v) => {
      const saved = company ? await api('PATCH', `/api/companies/${company.id}`, v) : await api('POST', '/api/companies', v);
      toast(company ? 'Empresa actualizada' : 'Empresa creada');
      await window.crm.refresh();
      onSaved?.(saved);
    },
  });
}

function companyDetail(c) {
  const contacts = S.contacts.filter((x) => x.companyId === c.id);
  const deals = S.deals.filter((d) => contacts.some((x) => x.id === d.contactId));
  const info = [['NIT', c.nit], ['Dominio', c.domain], ['Teléfono', c.phone], ['Correo', c.email], ['Dirección', c.address],
    ['Ciudad', c.city], ['Departamento', c.department], ['País', c.country], ['Sector', c.sector], ['Empleados', c.employees],
    ['Fuente', c.source], ['Responsable', userName(c.assignedTo)], ['Creada', fmtDate(c.createdAt)]];
  return `
    <div class="detail-grid">${info.map(([k, v]) => `<div><small>${k}</small><span>${esc(v || '—')}</span></div>`).join('')}</div>
    ${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : ''}
    <h4>Contactos (${contacts.length})</h4>
    ${contacts.length ? `<ul class="mini-list">${contacts.map((x) => `<li><a href="#" data-action="open-contact" data-id="${esc(x.id)}">${esc(x.name)}</a><small>${esc(x.email || x.phone || '')}</small></li>`).join('')}</ul>` : '<p class="muted">Sin contactos visibles.</p>'}
    <h4>Negocios (${deals.length})</h4>
    ${deals.length ? `<ul class="mini-list">${deals.map((d) => `<li><a href="#" data-action="open-deal" data-id="${esc(d.id)}">${esc(d.title)}</a><small>${esc(stageLabel(d.stage))} · ${money(d.value)}</small></li>`).join('')}</ul>` : '<p class="muted">Sin negocios.</p>'}`;
}

export function openCompany(companyId) {
  const c = companyById(companyId);
  if (!c) return;
  const footer = () => {
    const cur = companyById(companyId);
    return `${isAdmin() ? `<button class="btn btn-danger-ghost" data-action="delete-company" data-id="${esc(companyId)}">${icon('trash')} Eliminar</button>` : ''}
      <span class="spacer"></span>
      ${cur && canManage(cur) ? `<button class="btn btn-primary" data-action="edit-company" data-id="${esc(companyId)}">${icon('edit')} Editar</button>` : ''}`;
  };
  const m = openModal({
    title: c.name,
    size: 'lg',
    body: companyDetail(c),
    footer: footer(),
    onData: () => {
      const cur = companyById(companyId);
      if (!cur) { m.close(); return; }
      m.setBody(companyDetail(cur));
      m.setFooter(footer());
    },
  });
}

export const actions = {
  'new-company': () => companyForm(),
  'open-company': (el) => openCompany(el.dataset.id),
  'edit-company': (el) => companyForm(companyById(el.dataset.id)),
  'delete-company': async (el) => {
    const c = companyById(el.dataset.id);
    if (!c) return;
    const n = S.contacts.filter((x) => x.companyId === c.id).length;
    const ok = await confirmDialog(`¿Eliminar la empresa "${c.name}"?${n ? `\nSus ${n} contacto(s) quedarán sin empresa (no se eliminan).` : ''}`, { title: 'Eliminar empresa', okText: 'Eliminar', danger: true });
    if (!ok) return;
    await api('DELETE', `/api/companies/${c.id}`);
    toast('Empresa eliminada');
    await window.crm.refresh();
  },
};

export const inputs = {
  'companies-q': (el) => { ui().q = el.value; window.crm.render(); },
};
