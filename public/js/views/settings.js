import {
  S, api, esc, icon, options, pct,
} from '../core.js';
import {
  openModal, confirmDialog, toast, alertDialog,
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
    <div class="page-head"><div><h1>Configuración</h1><p class="muted">Etapas del pipeline y comisiones — sin tocar código</p></div></div>
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

export const actions = {
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

export const inputs = {
  'stage-label': (el) => { draft()[Number(el.dataset.index)].label = el.value; },
  'stage-prob': (el) => { draft()[Number(el.dataset.index)].probability = el.value; },
};
