-- Futurocol Academy CRM — esquema inicial
-- Los IDs son TEXT para poder importar tal cual los IDs del CRM anterior (localStorage).
-- La columna "extra" guarda cualquier campo del backup original que no tenga columna propia,
-- para no perder información durante la migración.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL,
  email           TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'asesor')),
  commission_rate NUMERIC(6,3) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  prefs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_version   INTEGER NOT NULL DEFAULT 0,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

-- assigned_to usa ON DELETE RESTRICT: un usuario no puede borrarse mientras tenga registros,
-- lo que garantiza a nivel de base de datos que nunca queden huérfanos (la API los reasigna antes).
CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  nit         TEXT,
  domain      TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  city        TEXT,
  department  TEXT,
  country     TEXT,
  sector      TEXT,
  employees   TEXT,
  source      TEXT,
  notes       TEXT,
  assigned_to TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX companies_assigned_idx ON companies (assigned_to);

CREATE TABLE contacts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
  program     TEXT,
  city        TEXT,
  notes       TEXT,
  assigned_to TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- bitácora: [{ id, type, text, author, at }]
  activity    JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_assigned_idx ON contacts (assigned_to);
CREATE INDEX contacts_company_idx ON contacts (company_id);
CREATE INDEX contacts_email_idx ON contacts (lower(email));
CREATE INDEX contacts_phone_digits_idx ON contacts (regexp_replace(coalesce(phone, ''), '\D', '', 'g'));

CREATE TABLE deals (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  contact_id          TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  value               NUMERIC(18,2) NOT NULL DEFAULT 0,
  stage               TEXT NOT NULL,
  deal_type           TEXT,
  product             TEXT,
  convocatoria        TEXT,
  probability         INTEGER CHECK (probability IS NULL OR (probability BETWEEN 0 AND 100)),
  expected_close_date DATE,
  close_date          DATE,
  competitor          TEXT,
  next_step           TEXT,
  loss_reason         TEXT,
  assigned_to         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- historial: [{ stage, from, at, by }]
  stage_history       JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Motivo de pérdida obligatorio (regla de negocio reforzada también en la base de datos)
  CONSTRAINT deals_loss_reason_required CHECK (stage <> 'perdido' OR length(trim(coalesce(loss_reason, ''))) > 0)
);
CREATE INDEX deals_assigned_idx ON deals (assigned_to);
CREATE INDEX deals_contact_idx ON deals (contact_id);
CREATE INDEX deals_stage_idx ON deals (stage);
CREATE INDEX deals_close_date_idx ON deals (close_date);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id       TEXT REFERENCES deals(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'otro',
  due_date      DATE,
  contact_time  TEXT,
  schedule_time TEXT,
  notes         TEXT,
  done          BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  assigned_to   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- identifica la automatización que creó la tarea; UNIQUE evita duplicados
  auto_rule     TEXT UNIQUE,
  extra         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_assigned_idx ON tasks (assigned_to);
CREATE INDEX tasks_contact_idx ON tasks (contact_id);
CREATE INDEX tasks_due_idx ON tasks (due_date);

-- Mensajes: sin FK a users para conservar el historial aunque se elimine un usuario.
CREATE TABLE messages (
  id        TEXT PRIMARY KEY,
  from_user TEXT NOT NULL,
  to_user   TEXT NOT NULL,
  text      TEXT NOT NULL,
  extra     JSONB NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_from_idx ON messages (from_user, at);
CREATE INDEX messages_to_idx ON messages (to_user, at);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_name      TEXT NOT NULL,
  by_user_id   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_label TEXT,
  detail       TEXT,
  extra        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type);

-- La auditoría es de solo inserción: nadie (ni el admin, ni la API) puede editarla o borrarla.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es de solo lectura (operación % no permitida)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Configuración (etapas del pipeline, comisiones)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de disparos de automatizaciones: evita crear dos veces la misma tarea automática
-- para el mismo disparador (aunque la tarea se borre después).
CREATE TABLE automation_log (
  rule       TEXT PRIMARY KEY,
  task_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
