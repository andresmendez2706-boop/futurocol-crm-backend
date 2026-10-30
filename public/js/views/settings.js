import {
  S, api, esc, icon, options, pct, CURRENCIES, currencyCode, allies, allyById,
} from '../core.js';
import {
  openModal, confirmDialog, toast, alertDialog, formModal,
} from '../ui.js';

export const id = 'configuracion';
export const title = 'Configuración';
export const navIcon = 'configuracion';
export const adminOnly = true;

// Borrador local del catálogo de etapas (se guarda con "Guardar etapas").
const ui = () => (S.ui.settings ||= { draft: null });
const draft = () => {
  const u = ui();
  if (!u.draft) u.draft = S.settings.stages.map((s) => ({ ...s }));
  return u.draft;
};

export function render() {
  const stages = draft();
  const c = S.settings.commissions;
  const openCount = stages.filter((s) => !s.protected).length;
  return `
    <div class="page-head"><div><h1>Configuración</h1><p class="muted">Aliados, moneda, etapas del pipeline y comisiones — sin tocar código</p></div></div>
    <section class="card">
      <div class="section-head"><h3>Aliados (universidades)</h3>
        <button class="btn btn-primary" data-action="ally-new">${icon('plus')} Nuevo aliado</button></div>
      <p class="muted">Cada aliado le paga a Futurocol su propio porcentaje sobre lo que se le factura y tiene su propia lista de programas. Los negocios, contactos y la facturación se pueden ver por aliado o unificados.</p>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Aliado</th><th class="num">% que paga a Futurocol</th><th class="num">Programas</th><th class="num">Negocios</th><th>Estado</th><th></th></tr></thead>
        <tbody>${allies().map((a) => `<tr>
          <td><span class="chip chip-ally">${esc(a.name)}</span></td><td class="num"><b>${pct(a.commissionRate)}</b></td>
          <td class="num">${a.programs.length}</td><td class="num">${S.deals.filter((d) => d.allyId === a.id).length}</td>
          <td>${a.active ? '<span class="chip chip-sm">Activo</span>' : '<span class="chip chip-sm chip-warn">Inactivo</span>'}</td>
          <td class="actions"><button class="icon-btn" data-action="ally-edit" data-id="${esc(a.id)}" title="Editar">${icon('edit')}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card">
      <h3>Moneda</h3>
      <p class="muted">Elige la moneda en la que se muestran todos los valores del CRM: negocios, facturación, comisiones y balance financiero.</p>
      <div class="currency-grid">${Object.entries(CURRENCIES).map(([code, c]) => `
        <label class="currency-option ${currencyCode() === code ? 'active' : ''}">
          <input type="radio" name="currency" value="${code}" ${currencyCode() === code ? 'checked' : ''} data-change="currency-pick">
          <strong>${esc(c.label)}</strong><span>${esc(c.sample)}</span>
        </label>`).join('')}</div>
      <p class="note">Cambiar la moneda solo cambia cómo se muestran los valores; <b>no convierte los montos</b>. Si cambias a dólares, un negocio de 4.500.000 se verá como US$ 4.500.000. Elige la moneda en la que el equipo registra los valores.</p>
    </section>

    <section class="card">
      <div class="section-head"><h3>Etapas del pipeline</h3>
        <div class="toolbar"><button class="btn" data-action="stage-add">${icon('plus')} Agregar etapa</button>
        <button class="btn" data-action="stage-reset">Descartar cambios</button>
        <button class="btn btn-primary" data-action="stage-save">Guardar etapas</button></div></div>
      <p class="muted">Las etapas <b>protegidas</b> (Aplazado, Cierre ganado, Cierre perdido) no se pueden eliminar ni cambiar de comportamiento —de ellas dependen las comisiones y el motivo de pérdida—, pero sí renombrar. La primera etapa es la de "Lead nuevo" que usan las automatizaciones.</p>
      <div class="stage-editor">${stages.map((s, i) => `
        <div class="stage-row ${s.protected ? 'protected' : ''}">
          <span class="stage-order">${i + 1}</span>
          <input id="stage-label-${i}" class="input" value="${esc(s.label)}" data-input="stage-label" data-index="${i}" maxlength="80">
          <label class="prob">Prob. <input id="stage-prob-${i}" class="input input-sm" type="number" min="0" max="100" value="${esc(s.probability)}" data-input="stage-prob" data-index="${i}" ${s.protected ? 'disabled' : ''}>%</label>
          <small class="muted stage-id">${esc(s.id || 'nueva')}</small>
          ${s.protected ? `<span class="chip chip-sm">${icon('lock', 'ico-sm')} protegida</span>` : `
            <button class="icon-btn" data-action="stage-move" data-index="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Subir">${icon('up')}</button>
            <button class="icon-btn" data-action="stage-move" data-index="${i}" data-dir="1" ${i >= openCount - 1 ? 'disabled' : ''} title="Bajar">${icon('down')}</button>
            <button class="icon-btn danger" data-action="stage-remove" data-index="${i}" title="Eliminar" ${openCount <= 1 ? 'disabled' : ''}>${icon('trash')}</button>`}
        </div>`).join('')}</div>
    </section>

    <section class="card">
      <h3>Comisiones</h3>
      <p class="muted">Cada usuario puede tener su propia tasa (se edita en <a href="#/usuarios">Usuarios</a>). Estos valores se usan solo para quien no tenga una tasa individual.</p>
      <form id="commissions-form" class="form-grid">
        <label class="field"><span>Tasa por defecto del admin (%) — sobre la facturación TOTAL</span><input class="input" name="adminDefault" type="number" min="0" max="100" step="0.1" value="${esc(c.adminDefault)}"></label>
        <label class="field"><span>Tasa por defecto de asesores (%) — sobre su facturación propia</span><input class="input" name="asesorDefault" type="number" min="0" max="100" step="0.1" value="${esc(c.asesorDefault)}"></label>
        <label class="field full"><span>Escalas sugeridas para asesores (%), separadas por coma</span><input class="input" name="asesorScales" value="${esc((c.asesorScales || []).join(', '))}"></label>
      </form>
      <div class="toolbar end"><button class="btn btn-primary" data-action="save-commissions">Guardar comisiones</button></div>
      <p class="muted">Actual: admin ${pct(c.adminDefault)} · asesor ${pct(c.asesorDefault)} · escalas ${(c.asesorScales || []).map(pct).join(' / ')}</p>
    </section>

    <section class="card">
      <h3>Automatizaciones</h3>
      <ul class="bullets">
        <li>Lead con 2+ días en la primera etapa sin actividad → tarea "Contactar lead".</li>
        <li>Negocio con 48 h en "Propuesta enviada" → tarea de seguimiento.</li>
        <li>Tareas vencidas → semáforo rojo. Motivo de pérdida obligatorio. Fecha de cierre automática al ganar/perder.</li>
      </ul>
      <p class="muted">Se ejecutan automáticamente en el servidor cada pocos minutos y nunca duplican una tarea.</p>
      <button class="btn" data-action="run-automations">Ejecutar ahora</button>
    </section>`;
}

async function saveStages(moveDeals = {}) {
  const stages = draft().map((s) => ({ id: s.id || undefined, label: s.label.trim(), probability: Number(s.probability) }));
  if (stages.some((s) => !s.label)) { await alertDialog('Todas las etapas necesitan un nombre.'); return; }
  try {
    const r = await api('PUT', '/api/settings/stages', { stages, moveDeals });
    ui().draft = null;
    toast(`Etapas guardadas${r.moved ? ` · ${r.moved} negocio(s) movidos` : ''}`);
    await window.crm.refresh();
  } catch (err) {
    if (err.code !== 'STAGE_IN_USE') throw err;
    const removed = S.settings.stages.find((s) => s.id === err.body.stage);
    const targets = draft().filter((s) => s.id && s.id !== 'ganado' && s.id !== 'perdido');
    const target = await new Promise((resolve) => {
      const m = openModal({
        title: 'Mover negocios',
        size: 'sm',
        body: `<p>La etapa <b>${esc(removed?.label || err.body.stage)}</b> tiene <b>${err.body.count}</b> negocio(s). ¿A qué etapa quieres moverlos?</p>
          <select class="input" id="move-target">${options(targets.map((s) => ({ value: s.id, label: s.label })), targets[0]?.id)}</select>`,
        footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Mover y guardar</button>',
        onClose: (r) => resolve(r || null),
      });
      m.query('[data-ok]').addEventListener('click', () => m.close(m.query('#move-target').value));
    });
    if (target) await saveStages({ ...moveDeals, [err.body.stage]: target });
  }
}

function allyForm(ally = null) {
  const a = ally || { active: true, programs: [] };
  formModal({
    title: ally ? `Editar aliado · ${ally.name}` : 'Nuevo aliado',
    fields: [
      { name: 'name', label: 'Nombre (ej. UNIR)', value: a.name, required: true },
      { name: 'commissionRate', label: '% que le paga a Futurocol', type: 'number', min: 0, max: 100, step: 0.1, value: a.commissionRate ?? '', required: true },
      { name: 'programs', label: 'Programas (uno por línea)', type: 'textarea', rows: 10, value: a.programs.join('\n'), full: true, hint: 'Estos programas aparecen al crear contactos y negocios de este aliado.' },
      ally ? { name: 'active', label: 'Activo (si lo desactivas, no se pueden crear negocios nuevos con él; su historia se conserva)', type: 'checkbox', value: a.active, full: true } : null,
    ],
    onSubmit: async (v) => {
      const body = {
        name: v.name, commissionRate: Number(v.commissionRate),
        programs: String(v.programs || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      };
      if (ally) body.active = !!v.active;
      if (ally) await api('PATCH', `/api/settings/allies/${ally.id}`, body);
      else await api('POST', '/api/settings/allies', body);
      toast(ally ? 'Aliado actualizado' : 'Aliado creado');
      await window.crm.refresh();
    },
  });
}

export const actions = {
  'ally-new': () => allyForm(),
  'ally-edit': (el) => allyForm(allyById(el.dataset.id)),
  'stage-add': () => {
    const d = draft();
    const idx = d.findIndex((s) => s.protected);
    d.splice(idx === -1 ? d.length : idx, 0, { id: null, label: 'Nueva etapa', probability: 50, protected: false });
    window.crm.render();
  },
  'stage-move': (el) => {
    const d = draft();
    const i = Number(el.dataset.index);
    const j = i + Number(el.dataset.dir);
    if (j < 0 || d[j]?.protected) return;
    [d[i], d[j]] = [d[j], d[i]];
    window.crm.render();
  },
  'stage-remove': async (el) => {
    const d = draft();
    const s = d[Number(el.dataset.index)];
    const n = S.deals.filter((x) => x.stage === s.id).length;
    const ok = await confirmDialog(`¿Eliminar la etapa "${s.label}"?${n ? `\nTiene ${n} negocio(s): al guardar se te pedirá a qué etapa moverlos.` : ''}`, { title: 'Eliminar etapa', okText: 'Eliminar', danger: true });
    if (!ok) return;
    d.splice(Number(el.dataset.index), 1);
    window.crm.render();
  },
  'stage-reset': () => { ui().draft = null; window.crm.render(); },
  'stage-save': () => saveStages(),
  'save-commissions': async () => {
    const f = document.getElementById('commissions-form');
    const v = Object.fromEntries(new FormData(f));
    const scales = String(v.asesorScales).split(/[,;\s]+/).filter(Boolean).map(Number);
    if (scales.some((x) => !Number.isFinite(x))) { await alertDialog('Las escalas deben ser números separados por coma.'); return; }
    await api('PUT', '/api/settings/commissions', { adminDefault: Number(v.adminDefault), asesorDefault: Number(v.asesorDefault), asesorScales: scales });
    toast('Comisiones guardadas');
    await window.crm.refresh();
  },
  'run-automations': async () => {
    const r = await api('POST', '/api/admin/automations/run');
    toast(r.created ? `${r.created} tarea(s) automática(s) creada(s)` : 'No hay tareas nuevas por crear');
    await window.crm.refresh();
  },
};

export const changes = {
  'currency-pick': async (el) => {
    const code = el.value;
    if (code === currencyCode()) return;
    const ok = await confirmDialog(`¿Mostrar todos los valores del CRM en ${CURRENCIES[code].label}?\n\nLos montos NO se convierten: solo cambia la moneda con la que se muestran.`, { title: 'Cambiar moneda', okText: 'Cambiar moneda' });
    if (!ok) { window.crm.render(); return; }
    await api('PUT', '/api/settings/currency', { currency: code });
    toast(`Moneda cambiada a ${code}`);
    await window.crm.refresh();
  },
};

export const inputs = {
  'stage-label': (el) => { draft()[Number(el.dataset.index)].label = el.value; },
  'stage-prob': (el) => { draft()[Number(el.dataset.index)].probability = el.value; },
};
