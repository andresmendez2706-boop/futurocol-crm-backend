'use strict';

// Automatizaciones del CRM (se ejecutan periódicamente en el servidor):
//  1. Lead con 2+ días en la primera etapa ("Lead nuevo") sin actividad → tarea "Contactar lead".
//  2. Negocio con 48h+ en "Propuesta enviada" → tarea de seguimiento.
// Las reglas 3-5 (semáforo vencido, motivo de pérdida, fecha de cierre) se aplican al mostrar
// las tareas y al cambiar de etapa (ver services/rules.js y routes/deals.js).
// Cada disparo se registra en automation_log para no duplicar nunca la tarea.

const db = require('../db');
const settings = require('./settings');
const { audit } = require('../audit');
const { PROPOSAL_STAGE } = require('../constants');
const { newId, todayISO, mapContact, mapDeal } = require('../util');
const realtime = require('../realtime');
const { lockTargets, findOpenTask } = require('./openTask');

const LEAD_IDLE_MS = 2 * 24 * 3600 * 1000;
const PROPOSAL_MS = 48 * 3600 * 1000;

function enteredStageAt(deal) {
  const h = [...(deal.stageHistory || [])].reverse().find((x) => x.stage === deal.stage);
  return new Date(h?.at || deal.createdAt);
}

async function createAutoTask(client, { rule, task, detail }) {
  // Misma regla que las tareas manuales: nunca una segunda tarea abierta en el contacto o negocio.
  const target = { contactId: task.contactId, dealId: task.dealId };
  await lockTargets(client, target);
  if (await findOpenTask(client, target)) return false;
  const ins = await client.query(
    'INSERT INTO automation_log (rule) VALUES ($1) ON CONFLICT (rule) DO NOTHING RETURNING rule',
    [rule],
  );
  if (ins.rowCount === 0) return false; // ya se disparó antes
  const id = newId('t');
  await client.query(
    `INSERT INTO tasks (id, contact_id, deal_id, title, type, due_date, notes, assigned_to, auto_rule)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, task.contactId, task.dealId || null, task.title, task.type, todayISO(), task.notes, task.assignedTo, rule],
  );
  await client.query('UPDATE automation_log SET task_id = $1 WHERE rule = $2', [id, rule]);
  await audit({ client, by: 'Sistema', action: 'automatización', entityType: 'tarea', entityLabel: task.title, detail });
  return true;
}

async function runAutomations({ now = new Date() } = {}) {
  const stages = await settings.getStages();
  const firstStage = stages[0]?.id;
  let created = 0;

  await db.tx(async (client) => {
    // Evita ejecuciones simultáneas entre varias instancias del servidor.
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(727002) AS ok');
    if (!lock.rows[0].ok) return;

    const contacts = (await client.query('SELECT * FROM contacts')).rows.map(mapContact);
    const deals = (await client.query('SELECT * FROM deals')).rows.map(mapDeal);
    const pending = (await client.query('SELECT contact_id, deal_id, auto_rule FROM tasks WHERE done = false')).rows;

    // --- Regla 1: lead estancado en la primera etapa sin actividad ---
    const latestDeal = new Map();
    for (const d of deals) {
      if (!d.contactId) continue;
      const prev = latestDeal.get(d.contactId);
      if (!prev || new Date(d.createdAt) > new Date(prev.createdAt)) latestDeal.set(d.contactId, d);
    }
    for (const c of contacts) {
      const deal = latestDeal.get(c.id);
      const stage = deal ? deal.stage : firstStage;
      if (stage !== firstStage) continue;
      const since = deal ? enteredStageAt(deal) : new Date(c.createdAt);
      if (now - since < LEAD_IDLE_MS) continue;
      const hasActivity = (c.activity || []).some((a) => new Date(a.at) >= since);
      if (hasActivity) continue;
      // Un contacto solo puede tener una tarea pendiente: si ya tiene una, no se crea otra.
      if (pending.some((t) => t.contact_id === c.id)) continue;
      const ok = await createAutoTask(client, {
        rule: `lead_sin_actividad:${c.id}`,
        task: {
          contactId: c.id, title: `Contactar lead: ${c.name}`, type: 'llamada', assignedTo: c.assignedTo,
          notes: 'Creada automáticamente: el lead lleva 2 o más días en la primera etapa sin actividad.',
        },
        detail: `Lead "${c.name}" sin actividad por 2+ días`,
      });
      if (ok) created++;
    }

    // --- Regla 2: negocio con 48h en "Propuesta enviada" ---
    if (stages.some((s) => s.id === PROPOSAL_STAGE)) {
      for (const d of deals) {
        if (d.stage !== PROPOSAL_STAGE || !d.contactId) continue;
        const since = enteredStageAt(d);
        if (now - since < PROPOSAL_MS) continue;
        // Ni el negocio ni su contacto pueden tener ya una tarea pendiente.
        if (pending.some((t) => t.deal_id === d.id || t.contact_id === d.contactId)) continue;
        const ok = await createAutoTask(client, {
          rule: `propuesta_48h:${d.id}:${since.toISOString()}`,
          task: {
            contactId: d.contactId, dealId: d.id, title: `Seguimiento a propuesta: ${d.title}`, type: 'propuesta',
            assignedTo: d.assignedTo,
            notes: 'Creada automáticamente: el negocio lleva 48 horas en "Propuesta enviada".',
          },
          detail: `Negocio "${d.title}" 48h en propuesta`,
        });
        if (ok) created++;
      }
    }
  });

  if (created > 0) realtime.notifyChange('tasks');
  return { created };
}

let timer = null;
function schedule(minutes) {
  const run = () => runAutomations().catch((err) => console.error('[automatizaciones]', err.message));
  setTimeout(run, 5000).unref();
  timer = setInterval(run, minutes * 60 * 1000);
  timer.unref();
}
function unschedule() {
  clearInterval(timer);
}

module.exports = { runAutomations, schedule, unschedule };
