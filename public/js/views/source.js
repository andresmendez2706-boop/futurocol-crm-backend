import { S, api, esc } from '../core.js';

export const id = 'codigo';
export const title = 'Código fuente';
export const navIcon = 'codigo';
export const adminOnly = true;

const ui = () => (S.ui.source ||= { file: null });

export async function render() {
  const { files } = await api('GET', '/api/admin/source');
  const u = ui();
  if (!u.file || !files.includes(u.file)) u.file = files.find((f) => f.endsWith('main.js')) || files[0];
  const text = u.file ? await api('GET', `/api/admin/source?file=${encodeURIComponent(u.file)}`) : '';
  return `
    <div class="page-head">
      <div><h1>Código fuente</h1><p class="muted">Archivos de la interfaz. El servidor (API, base de datos) está en el repositorio del proyecto: <code>src/</code> y <code>db/migrations/</code>.</p></div>
    </div>
    <div class="source">
      <aside class="source-files">${files.map((f) => `<button class="${f === u.file ? 'active' : ''}" data-action="source-file" data-file="${esc(f)}">${esc(f)}</button>`).join('')}</aside>
      <pre class="source-code" data-scroll-key="source"><code>${esc(text)}</code></pre>
    </div>`;
}

export const actions = {
  'source-file': (el) => { ui().file = el.dataset.file; window.crm.render(); },
};
