import {
  S, api, esc, icon, pct, fmtDate, effectiveRate, userById,
} from '../core.js';
import {
  formModal, confirmDialog, toast, emptyState,
} from '../ui.js';

export const id = 'usuarios';
export const title = 'Usuarios';
export const navIcon = 'usuarios';
export const adminOnly = true;

export async function render() {
  const users = await api('GET', '/api/users');
  S.ui.usersFull = users;
  return `
    <div class="page-head">
      <div><h1>Usuarios</h1><p class="muted">${users.length} cuenta(s) · el correo es el acceso al CRM</p></div>
      <div class="toolbar"><button class="btn btn-primary" data-action="new-user">${icon('plus')} Nuevo usuario</button></div>
    </div>
    <div class="card no-pad">${users.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th class="num">Comisión</th><th class="num">Contactos</th><th class="num">Negocios</th><th>Creado</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td><strong>${esc(u.name)}</strong>${u.id === S.me.id ? ' <span class="chip chip-sm">tú</span>' : ''}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.email)}${/@sin-correo\.invalid$/.test(u.email) ? ' <span class="chip chip-sm chip-warn">actualizar</span>' : ''}</td>
        <td><span class="chip chip-sm ${u.role === 'admin' ? 'chip-admin' : ''}">${u.role === 'admin' ? 'Administrador' : 'Asesor'}</span></td>
        <td class="num">${pct(effectiveRate(u))}${u.commissionRate === null || u.commissionRate === undefined ? ' <small class="muted">(por defecto)</small>' : ''}
          <small class="block muted">${u.role === 'admin' ? 'sobre facturación total' : 'sobre sus ventas'}</small></td>
        <td class="num">${S.contacts.filter((c) => c.assignedTo === u.id).length}</td>
        <td class="num">${S.deals.filter((d) => d.assignedTo === u.id).length}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td class="actions"><button class="icon-btn" data-action="edit-user" data-id="${esc(u.id)}" title="Editar">${icon('edit')}</button>
          ${u.id !== S.me.id ? `<button class="icon-btn danger" data-action="delete-user" data-id="${esc(u.id)}" title="Eliminar">${icon('trash')}</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : emptyState('No hay usuarios.')}</div>`;
}

function userForm(user = null) {
  const u = user || {};
  const scales = S.settings.commissions.asesorScales || [];
  formModal({
    title: user ? `Editar usuario · ${user.name}` : 'Nuevo usuario',
    fields: [
      { name: 'name', label: 'Nombre completo', value: u.name, required: true, full: true },
      { name: 'email', label: 'Correo (acceso al CRM)', type: 'email', value: u.email, required: true },
      { name: 'username', label: 'Nombre de usuario', value: u.username, required: true, hint: 'Letras, números, punto o guion.' },
      { name: 'role', label: 'Rol', type: 'select', value: u.role || 'asesor', options: [{ value: 'asesor', label: 'Asesor' }, { value: 'admin', label: 'Administrador' }] },
      {
        name: 'commissionRate', label: 'Tasa de comisión individual (%)', type: 'number', min: 0, max: 100, step: 0.1, list: 'rate-scales',
        value: u.commissionRate ?? '', placeholder: 'Vacío = valor por defecto del rol',
        hint: `Asesor: sobre lo que él cierra. Admin: sobre la facturación total. Escalas sugeridas: ${scales.map(pct).join(' / ') || '—'}`,
      },
      { name: 'password', label: user ? 'Nueva contraseña (opcional)' : 'Contraseña', type: 'password', required: !user, full: true, hint: 'Mínimo 8 caracteres.' },
    ],
    extraBody: `<datalist id="rate-scales">${scales.map((s) => `<option value="${s}">`).join('')}</datalist>`,
    onSubmit: async (v) => {
      const body = { ...v, commissionRate: v.commissionRate === '' ? null : Number(v.commissionRate) };
      if (user && !body.password) delete body.password;
      if (user) await api('PATCH', `/api/users/${user.id}`, body);
      else await api('POST', '/api/users', body);
      toast(user ? 'Usuario actualizado' : 'Usuario creado');
      await window.crm.refresh();
    },
  });
}

export const actions = {
  'new-user': () => userForm(),
  'edit-user': (el) => userForm((S.ui.usersFull || []).find((u) => u.id === el.dataset.id) || userById(el.dataset.id)),
  'delete-user': async (el) => {
    const u = (S.ui.usersFull || []).find((x) => x.id === el.dataset.id);
    if (!u) return;
    const counts = ['contacts', 'deals', 'tasks', 'companies'].map((k) => S[k].filter((r) => r.assignedTo === u.id).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const ok = await confirmDialog(
      `¿Eliminar la cuenta de ${u.name} (${u.email})?${total ? `\n\nSus registros se reasignarán a ti automáticamente:\n• ${counts[0]} contactos\n• ${counts[1]} negocios\n• ${counts[2]} tareas\n• ${counts[3]} empresas` : ''}`,
      { title: 'Eliminar usuario', okText: 'Eliminar y reasignar', danger: true },
    );
    if (!ok) return;
    await api('DELETE', `/api/users/${u.id}`);
    toast('Usuario eliminado');
    await window.crm.refresh();
  },
};
