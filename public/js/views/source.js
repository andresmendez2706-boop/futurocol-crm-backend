import { S, api, esc } from '../core.js';

export const id = 'codigo';
export const title = 'Código fuente';
export const navIcon = 'codigo';
export const adminOnly = true;

const ui = () => (S.ui.source ||= { file: null, next: 0 });

// Líneas "muy importantes" (se muestran en rojo): permisos, eliminaciones, contraseñas/sesión
// y comentarios que describen reglas obligatorias.
const IMPORTANT_CODE = /\b(canManage|canEditTask|isAdmin|requireAdmin|adminOnly|assertCanManage|password|contraseña|setUnauthorizedHandler|logout)\b|'DELETE'|"DELETE"/i;
const IMPORTANT_COMMENT = /(importante|obligatori|nunca|no se puede|no puede|solo el admin|solo el responsable|seguridad|permiso|regla|duplic|protegid|no se guarda|nunca se)/i;
const isComment = (line) => /^\s*(\/\/|\/\*|\*|<!--)/.test(line);
const isImportant = (line) => IMPORTANT_CODE.test(line) || (isComment(line) && IMPORTANT_COMMENT.test(line));

export async function render() {
  const { files } = await api('GET', '/api/admin/source');
  const u = ui();
  if (!u.file || !files.includes(u.file)) u.file = files.find((f) => f.endsWith('main.js')) || files[0];
  const text = u.file ? await api('GET', `/api/admin/source?file=${encodeURIComponent(u.file)}`) : '';
  let count = 0;
  const html = text.split('\n').map((line) => {
    if (!isImportant(line)) return esc(line);
    count += 1;
    return `<span class="code-important" data-imp="${count}">${esc(line)}</span>`;
  }).join('\n');
  u.count = count;
  return `
    <div class="page-head">
      <div><h1>Código fuente</h1><p class="muted">Archivos de la interfaz. El servidor (API, base de datos) está en el repositorio del proyecto: <code>src/</code> y <code>db/migrations/</code>.</p></div>
    </div>
    <div class="code-legend">
      <span><i class="lg-green"></i>Código</span>
      <span><i class="lg-red"></i>Muy importante: permisos, eliminaciones, contraseñas y reglas obligatorias</span>
      ${count ? `<button class="btn btn-sm" data-action="source-next">Ir a la siguiente importante (${count})</button>` : '<span class="muted">Este archivo no tiene líneas marcadas.</span>'}
    </div>
    <div class="source">
      <aside class="source-files">${files.map((f) => `<button class="${f === u.file ? 'active' : ''}" data-action="source-file" data-file="${esc(f)}">${esc(f)}</button>`).join('')}</aside>
      <pre class="source-code" data-scroll-key="source" id="source-code"><code>${html}</code></pre>
    </div>`;
}

export const actions = {
  'source-file': (el) => { Object.assign(ui(), { file: el.dataset.file, next: 0 }); window.crm.render(); },
  // Salta, dentro del recuadro, a la siguiente línea marcada en rojo.
  'source-next': () => {
    const u = ui();
    if (!u.count) return;
    u.next = (u.next % u.count) + 1;
    const pre = document.getElementById('source-code');
    const line = pre?.querySelector(`[data-imp="${u.next}"]`);
    if (!line) return;
    pre.scrollTop = line.offsetTop - pre.clientHeight / 3;
    pre.querySelectorAll('.code-important.current').forEach((x) => x.classList.remove('current'));
    line.classList.add('current');
  },
};
