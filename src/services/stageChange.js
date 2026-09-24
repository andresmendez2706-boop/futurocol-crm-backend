'use strict';

// Reglas obligatorias al cambiar un negocio de etapa:
//  - A "perdido": exige motivo de pérdida (si el negocio no tiene uno ya).
//  - A "ganado" o "perdido": registra closeDate = fecha actual.
//  - Siempre: agrega al stageHistory { stage, from, at, by }.

const { WON, LOST } = require('../constants');
const { HttpError, todayISO } = require('../util');

function planStageChange({ current, nextStage, lossReason, stages, user }) {
  if (!stages.some((s) => s.id === nextStage)) throw new HttpError(400, `La etapa "${nextStage}" no existe`);
  const from = current ? current.stage : null;
  if (current && from === nextStage) return null;

  const reason = (lossReason ?? '').trim() || (current?.loss_reason ?? '').trim();
  if (nextStage === LOST && !reason) {
    throw new HttpError(422, 'Debes indicar el motivo de pérdida para cerrar el negocio como perdido', { code: 'LOSS_REASON_REQUIRED' });
  }
  const columns = { stage: nextStage };
  if (nextStage === LOST) columns.loss_reason = reason;
  if (nextStage === WON || nextStage === LOST) columns.close_date = todayISO();

  const entry = { stage: nextStage, from, at: new Date().toISOString(), by: user.name };
  const label = (id) => stages.find((s) => s.id === id)?.label || id;
  let action = 'cambio de etapa';
  if (nextStage === WON) action = 'cierre ganado';
  if (nextStage === LOST) action = 'cierre perdido';
  const detail = from
    ? `${label(from)} → ${label(nextStage)}${nextStage === LOST ? ` (motivo: ${reason})` : ''}`
    : `Etapa inicial: ${label(nextStage)}`;
  return { columns, entry, action, detail };
}

module.exports = { planStageChange };
