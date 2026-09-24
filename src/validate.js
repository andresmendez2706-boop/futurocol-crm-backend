'use strict';

const { z } = require('zod');
const { HttpError } = require('./util');

// Texto opcional: '' → null, recorta espacios.
const optText = (max = 2000) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
    z.string().max(max).nullable().optional());

const reqText = (max = 300) => z.string().trim().min(1, 'es obligatorio').max(max);

const optDate = z.preprocess((v) => (v === '' ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha inválida (AAAA-MM-DD)').nullable().optional());

const optTime = z.preprocess((v) => (v === '' ? null : v),
  z.string().regex(/^\d{2}:\d{2}$/, 'hora inválida (HH:MM)').nullable().optional());

const optNumber = (min, max) => z.preprocess((v) => (v === '' ? null : v === undefined || v === null ? v : Number(v)),
  z.number().min(min).max(max).nullable().optional());

const email = z.string().trim().toLowerCase().email('correo inválido').max(200);

function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    throw new HttpError(400, field ? `${field}: ${issue.message}` : issue.message, { issues: r.error.issues });
  }
  return r.data;
}

module.exports = { z, optText, reqText, optDate, optTime, optNumber, email, parse };
