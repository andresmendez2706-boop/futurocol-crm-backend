'use strict';

const PROGRAMS = [
  'Analítica de Datos',
  'Transformación Digital',
  'Gestión de Tecnologías de la Información',
  'Gerencia para la Transición Energética',
  'Ciberseguridad',
  'Inteligencia Artificial',
  'Paz y Desarrollo Territorial',
  'Contratación Estatal',
  'Marketing Político',
  'Marketing Digital',
  'Diseño y Desarrollo de Videojuegos',
  'Gerencia de la Marca',
  'Gerencia Educativa',
  'Gestión de Negocios Digitales',
  'Prospectiva Estratégica',
  'Desarrollo Organizacional y Gestión del Talento Humano',
  'Gerencia Financiera',
  'Gerencia de Proyectos',
  'Inteligencia de Negocios',
  'Alta Gerencia',
  'Seguridad y Salud en el Trabajo',
  'Gestión de la Innovación del Sistema Moda',
];

const DEAL_TYPES = ['Pregrado', 'Diplomado', 'Especialización', 'Maestría', 'Doctorado'];

const TASK_TYPES = ['llamada', 'concertacion', 'entrevista', 'reunion', 'documentos', 'propuesta', 'matricula', 'otro'];

const ACTIVITY_TYPES = ['nota', 'llamada', 'whatsapp', 'email', 'reunion', 'videollamada', 'visita', 'seguimiento', 'propuesta'];

const DEFAULT_STAGES = [
  { id: 'prospecto', label: 'Lead nuevo', probability: 10 },
  { id: 'contactado', label: 'Contactado', probability: 20 },
  { id: 'contacto_efectivo', label: 'Contacto efectivo', probability: 30 },
  { id: 'reunion_agendada', label: 'Reunión agendada', probability: 40 },
  { id: 'propuesta', label: 'Propuesta enviada', probability: 50 },
  { id: 'negociacion', label: 'Negociación', probability: 70 },
  { id: 'aplazado', label: 'Aplazado', probability: 25, protected: true },
  { id: 'ganado', label: 'Cierre ganado', probability: 100, protected: true },
  { id: 'perdido', label: 'Cierre perdido', probability: 0, protected: true },
];

// Etapas protegidas: no se pueden eliminar ni cambiar de comportamiento (sí renombrar).
const PROTECTED_STAGES = ['aplazado', 'ganado', 'perdido'];
const CLOSED_STAGES = ['ganado', 'perdido', 'aplazado'];
const WON = 'ganado';
const LOST = 'perdido';
const PROPOSAL_STAGE = 'propuesta';

const DEFAULT_COMMISSIONS = {
  adminDefault: 2, // % sobre la facturación TOTAL de la academia (comisión de gerencia)
  asesorDefault: 5, // % sobre la facturación propia del asesor
  asesorScales: [5, 8, 10], // escalas sugeridas para asesores
};

const AUDIT_ACTIONS = [
  'creación', 'edición', 'eliminación', 'cambio de etapa', 'cierre ganado', 'cierre perdido',
  'cambio de responsable', 'cambio de permisos', 'cambio de comisión', 'configuración',
  'importación', 'backup', 'restauración', 'limpieza', 'inicio de sesión', 'automatización',
];

module.exports = {
  PROGRAMS, DEAL_TYPES, TASK_TYPES, ACTIVITY_TYPES, DEFAULT_STAGES, PROTECTED_STAGES,
  CLOSED_STAGES, WON, LOST, PROPOSAL_STAGE, DEFAULT_COMMISSIONS, AUDIT_ACTIONS,
};
