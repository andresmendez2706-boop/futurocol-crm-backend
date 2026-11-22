'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, seed, PDF_BASE64, attachRequiredDocs,
} = require('./helpers');

let s;
let contact;
test.before(async () => {
  s = await seed();
  contact = (await s.a1.post('/api/contacts', { name: 'Estudiante' })).body;
});
test.after(() => db.pool.end());

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

test('sin cédula, diploma y acta de grado no se puede marcar como ganado', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'Esp', contactId: contact.id, value: 100 })).body;
  let r = await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'DOCUMENTS_REQUIRED');
  assert.deepEqual(r.body.missing, ['cedula', 'diploma', 'acta_grado']);

  await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'cedula', fileName: 'cc.pdf', data: PDF_BASE64 });
  r = await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.missing, ['diploma', 'acta_grado']);
  // ni siquiera el admin se salta la regla
  assert.equal((await s.admin.patch(`/api/deals/${d.id}`, { stage: 'ganado' })).status, 422);

  await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'diploma', fileName: 'diploma.png', data: PNG_BASE64 });
  await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'acta_grado', fileName: 'acta.pdf', data: PDF_BASE64 });
  r = await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  assert.equal(r.status, 200);
  assert.equal(r.body.stage, 'ganado');
});

test('un negocio no puede crearse directamente como ganado', async () => {
  const r = await s.a1.post('/api/deals', { title: 'X', contactId: contact.id, stage: 'ganado' });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'DOCUMENTS_REQUIRED');
});

test('se valida el contenido real del archivo y el tamaño', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'V', contactId: contact.id })).body;
  const fake = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'cedula', fileName: 'x.pdf', data: fake })).status, 415);
  const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.equal((await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'cedula', fileName: 'x.pdf', data: big })).status, 413);
  assert.equal((await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'pasaporte', fileName: 'x.pdf', data: PDF_BASE64 })).status, 400);
});

test('documentos: listado, descarga y permisos', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'P', contactId: contact.id })).body;
  const doc = (await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'cedula', fileName: 'cédula juan.pdf', data: PDF_BASE64 })).body;
  assert.equal(doc.mimeType, 'application/pdf');
  // aparece en el listado de negocios (sin el contenido)
  const deals = (await s.a1.get('/api/deals')).body;
  const listed = deals.find((x) => x.id === d.id).documents;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].data, undefined);
  // descarga
  const file = await s.a1.get(`/api/deals/${d.id}/documents/${doc.id}`).buffer(true).parse((res, cb) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.equal(file.body.toString('base64'), PDF_BASE64);
  // otro asesor no puede ver, subir ni borrar; el admin sí puede ver
  assert.equal((await s.a2.get(`/api/deals/${d.id}/documents/${doc.id}`)).status, 403);
  assert.equal((await s.a2.post(`/api/deals/${d.id}/documents`, { type: 'otro', fileName: 'x.pdf', data: PDF_BASE64 })).status, 403);
  assert.equal((await s.a2.del(`/api/deals/${d.id}/documents/${doc.id}`)).status, 403);
  assert.equal((await s.admin.get(`/api/deals/${d.id}/documents/${doc.id}`)).status, 200);
  // queda en la auditoría
  const { rows } = await db.query("SELECT * FROM audit_log WHERE entity_type = 'documento' AND entity_label = 'P'");
  assert.ok(rows.length >= 1);
  // borrar en un negocio abierto sí se puede
  assert.equal((await s.a1.del(`/api/deals/${d.id}/documents/${doc.id}`)).status, 200);
});

test('en un negocio ganado no se puede quitar el único documento obligatorio de un tipo', async () => {
  const d = (await s.a1.post('/api/deals', { title: 'W', contactId: contact.id })).body;
  await attachRequiredDocs(s.a1, d.id);
  await s.a1.patch(`/api/deals/${d.id}`, { stage: 'ganado' });
  const docs = (await s.a1.get(`/api/deals/${d.id}/documents`)).body;
  const cedula = docs.find((x) => x.type === 'cedula');
  const r = await s.a1.del(`/api/deals/${d.id}/documents/${cedula.id}`);
  assert.equal(r.status, 422);
  // con el reemplazo subido, ya se puede borrar el anterior
  await s.a1.post(`/api/deals/${d.id}/documents`, { type: 'cedula', fileName: 'nueva.pdf', data: PDF_BASE64 });
  assert.equal((await s.a1.del(`/api/deals/${d.id}/documents/${cedula.id}`)).status, 200);
});

test('los documentos viajan en la copia de seguridad', async () => {
  const backup = (await s.admin.get('/api/admin/backup')).body;
  assert.ok(Array.isArray(backup.documents) && backup.documents.length > 0);
  assert.ok(backup.documents[0].data);
});
