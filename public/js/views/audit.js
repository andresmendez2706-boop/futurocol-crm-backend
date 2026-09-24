import {
  S, api, esc, icon, options, fmtDateTime,
} from '../core.js';
import {
  openModal, confirmDialog, alertDialog, emptyState, toast,
} from '../ui.js';

export const id = 'auditoria';
export const title = 'Auditoría';
export const navIcon = 'auditoria';
export const adminOnly = true;

const ACTIONS = ['creación', 'edición', 'eliminación', 'cambio de etapa', 'cierre ganado', 'cierre perdido', 'cambio de responsable',
  'cambio de permisos', 'cambio de comisión', 'configuración', 'importación', 'backup', 'restauración', 'limpieza', 'inicio de sesión', 'automatización'];

const ui = () => (S.ui.audit ||= { entityType: '', action: '', q: '' });

export async function render() {
  const u = ui();
  const q = new URLSearchParams({ limit: '1000' });
  if (u.entityType) q.set('entityType', u.entityType);
  if (u.action) q.set('action', u.action);
  const { entries, entityTypes } = await api('GET', `/api/admin/audit?${q}`);
  const t = u.q.trim().toLowerCase();
  const list = t ? entries.filter((e) => [e.by, e.entityLabel, e.detail].some((v) => v && v.toLowerCase().includes(t))) : entries;
  return `
    <div class="page-head">
      <div><h1>Auditoría</h1><p class="muted">Historial de acciones (solo lectura) · ${list.length} registro(s)</p></div>
      <div class="toolbar">
        <input id="audit-q" class="input" placeholder="Buscar usuario, registro, detalle…" value="${esc(u.q)}" data-input="audit-q">
        <select class="input input-sm" data-change="audit-entity">${options(entityTypes, u.entityType, { empty: 'Todas las entidades' })}</select>
        <select class="input input-sm" data-change="audit-action">${options(ACTIONS, u.action, { empty: 'Todas las acciones' })}</select>
      </div>
    </div>
    <section class="card backup-card">
      <div>
        <h3>Copias de seguridad</h3>
        <p class="muted">Descarga una copia completa (.json) de contactos, empresas, negocios, tareas, usuarios, mensajes, configuración y auditoría.
        También puedes cargar una copia —incluida la del CRM anterior— para fusionarla o restaurarla.</p>
      </div>
      <div class="toolbar">
        <a class="btn btn-primary" href="/api/admin/backup" download>${icon('download')} Descargar copia de seguridad</a>
        <label class="btn">${icon('upload')} Cargar copia (.json)<input type="file" accept=".json,application/json" hidden data-change="backup-file"></label>
      </div>
    </section>
    <div class="card no-pad">
      ${list.length ? `<div class="table-wrap" data-scroll-key="audit"><table class="table compact">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Registro</th><th>Detalle</th></tr></thead>
        <tbody>${list.map((e) => `<tr><td class="nowrap">${fmtDateTime(e.at)}</td><td>${esc(e.by)}</td>
          <td><span class="chip chip-sm action-${esc(e.action.replace(/\s+/g, '-'))}">${esc(e.action)}</span></td>
          <td>${esc(e.entityType || '—')}</td><td>${esc(e.entityLabel || '—')}</td><td class="detail-cell">${esc(e.detail || '')}</td></tr>`).join('')}</tbody>
      </table></div>` : emptyState('Sin registros.')}
    </div>`;
}

function chooseMode(fileName) {
  return new Promise((resolve) => {
    const m = openModal({
      title: 'Cargar copia de seguridad',
      body: `<p>Archivo: <b>${esc(fileName)}</b></p>
        <div class="choice-grid">
          <button class="choice" data-mode="merge"><strong>Fusionar</strong><small>Agrega los registros que no existen. Lo actual se conserva. Recomendado para la migración inicial.</small></button>
          <button class="choice danger" data-mode="replace"><strong>Restaurar (reemplazar)</strong><small>Reemplaza empresas, contactos, negocios, tareas y mensajes por los de la copia. Los usuarios se actualizan. La auditoría nunca se borra.</small></button>
        </div>`,
      footer: '<button class="btn" data-close>Cancelar</button>',
      onClose: (r) => resolve(r || null),
    });
    m.el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => m.close(b.dataset.mode)));
  });
}

export const changes = {
  'audit-entity': (el) => { ui().entityType = el.value; window.crm.render(); },
  'audit-action': (el) => { ui().action = el.value; window.crm.render(); },
  'backup-file': async (el) => {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      await alertDialog('El archivo no es un JSON válido.', { title: 'Copia de seguridad' });
      return;
    }
    const mode = await chooseMode(file.name);
    if (!mode) return;
    if (mode === 'replace') {
      const ok = await confirmDialog('Se reemplazarán TODOS los contactos, empresas, negocios, tareas y mensajes actuales por los de la copia.\n¿Continuar?', { title: 'Restaurar copia', okText: 'Restaurar', danger: true });
      if (!ok) return;
    }
    toast('Procesando copia de seguridad…');
    const r = await api('POST', '/api/admin/backup/import', { data, mode });
    const lines = Object.entries(r.stats).map(([k, v]) => `• ${k}: ${v.inserted} nuevos${v.updated ? `, ${v.updated} actualizados` : ''}${v.skipped ? `, ${v.skipped} ya existían` : ''}`);
    await window.crm.refresh();
    await alertDialog(`${mode === 'replace' ? 'Restauración' : 'Fusión'} completada.\n\n${lines.join('\n') || 'Sin registros.'}${r.warnings.length ? `\n\nAvisos:\n${r.warnings.map((w) => `• ${w}`).join('\n')}` : ''}`, { title: 'Copia de seguridad' });
  },
};

export const inputs = {
  'audit-q': (el) => { ui().q = el.value; window.crm.render(); },
};

export const actions = {};
