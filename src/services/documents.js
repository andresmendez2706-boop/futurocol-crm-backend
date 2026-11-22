'use strict';

// Documentos adjuntos de los negocios (cédula, diploma, acta de grado, otros).
//
// Regla obligatoria: un negocio solo puede pasar a "Cierre ganado" si tiene adjuntos todos los
// documentos obligatorios (REQUIRED_DOCUMENTS). Mientras esté ganado, tampoco se puede eliminar
// el último archivo de un tipo obligatorio (primero hay que subir el reemplazo).

const db = require('../db');
const {
  DOCUMENT_TYPES, REQUIRED_DOCUMENTS, MAX_DOCUMENT_BYTES,
} = require('../constants');
const { HttpError } = require('../util');

const typeLabel = (id) => DOCUMENT_TYPES.find((t) => t.id === id)?.label || id;

// El tipo real del archivo se detecta por su contenido (no se confía en lo que diga el navegador).
function detectMime(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Decodifica y valida el archivo enviado en base64 (acepta también "data:...;base64,").
function decodeFile(base64) {
  const clean = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!clean || !/^[A-Za-z0-9+/]+=*$/.test(clean)) throw new HttpError(400, 'El archivo no es válido');
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) throw new HttpError(400, 'El archivo está vacío');
  if (buf.length > MAX_DOCUMENT_BYTES) {
    throw new HttpError(413, `El archivo supera el máximo de ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`);
  }
  const mime = detectMime(buf);
  if (!mime) throw new HttpError(415, 'Formato no permitido: adjunta un PDF o una imagen (JPG, PNG o WEBP)');
  return { buf, mime };
}

const mapDocument = (r) => ({
  id: r.id, dealId: r.deal_id, type: r.doc_type, fileName: r.file_name, mimeType: r.mime_type,
  size: r.size_bytes, uploadedBy: r.uploaded_by, uploadedByName: r.uploaded_by_name,
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
});

const META_COLUMNS = 'id, deal_id, doc_type, file_name, mime_type, size_bytes, uploaded_by, uploaded_by_name, created_at';

// Metadatos (sin el contenido) de los documentos de varios negocios, agrupados por negocio.
async function listMetaByDeal(dealIds, client = db) {
  const out = new Map();
  if (!dealIds.length) return out;
  const { rows } = await client.query(
    `SELECT ${META_COLUMNS} FROM deal_documents WHERE deal_id = ANY($1::text[]) ORDER BY created_at`, [dealIds],
  );
  for (const r of rows) {
    if (!out.has(r.deal_id)) out.set(r.deal_id, []);
    out.get(r.deal_id).push(mapDocument(r));
  }
  return out;
}

async function missingRequired(dealId, client = db) {
  const { rows } = await client.query('SELECT DISTINCT doc_type FROM deal_documents WHERE deal_id = $1', [dealId]);
  const have = new Set(rows.map((r) => r.doc_type));
  return REQUIRED_DOCUMENTS.filter((t) => !have.has(t));
}

// Obligatorio: sin los documentos requeridos no se puede cerrar como ganado.
async function assertRequiredForWin(dealId, client = db) {
  const missing = dealId ? await missingRequired(dealId, client) : [...REQUIRED_DOCUMENTS];
  if (missing.length) {
    throw new HttpError(
      422,
      `Para marcar el negocio como ganado debes adjuntar: ${missing.map(typeLabel).join(', ')}`,
      { code: 'DOCUMENTS_REQUIRED', missing },
    );
  }
}

module.exports = {
  detectMime, decodeFile, mapDocument, listMetaByDeal, missingRequired, assertRequiredForWin, typeLabel, META_COLUMNS,
};
