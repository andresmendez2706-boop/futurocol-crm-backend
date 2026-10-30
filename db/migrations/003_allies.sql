-- Aliados (instituciones universitarias cuyo portafolio vende Futurocol, p. ej. CUN y UNIR).
-- Cada aliado le paga a Futurocol su propio porcentaje sobre lo facturado y tiene su lista de programas.
CREATE TABLE allies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  commission_rate NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  programs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX allies_name_key ON allies (lower(name));

-- Aliado inicial: CUN, con el porcentaje que hasta ahora tenía el administrador y los 22 programas.
INSERT INTO allies (id, name, commission_rate, programs)
VALUES (
  'ally_cun', 'CUN',
  COALESCE(
    (SELECT commission_rate FROM users WHERE role = 'admin' AND commission_rate IS NOT NULL ORDER BY created_at LIMIT 1),
    (SELECT (value->>'adminDefault')::numeric FROM settings WHERE key = 'commissions'),
    2
  ),
  '["Analítica de Datos","Transformación Digital","Gestión de Tecnologías de la Información","Gerencia para la Transición Energética","Ciberseguridad","Inteligencia Artificial","Paz y Desarrollo Territorial","Contratación Estatal","Marketing Político","Marketing Digital","Diseño y Desarrollo de Videojuegos","Gerencia de la Marca","Gerencia Educativa","Gestión de Negocios Digitales","Prospectiva Estratégica","Desarrollo Organizacional y Gestión del Talento Humano","Gerencia Financiera","Gerencia de Proyectos","Inteligencia de Negocios","Alta Gerencia","Seguridad y Salud en el Trabajo","Gestión de la Innovación del Sistema Moda"]'::jsonb
);

ALTER TABLE deals    ADD COLUMN ally_id TEXT REFERENCES allies(id) ON DELETE RESTRICT;
ALTER TABLE contacts ADD COLUMN ally_id TEXT REFERENCES allies(id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD COLUMN ally_id TEXT REFERENCES allies(id) ON DELETE RESTRICT; -- NULL = gasto general de Futurocol
-- Aliados que vende cada asesor ([] = todos).
ALTER TABLE users    ADD COLUMN ally_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE deals SET ally_id = 'ally_cun' WHERE ally_id IS NULL;
UPDATE contacts SET ally_id = 'ally_cun' WHERE ally_id IS NULL;

CREATE INDEX deals_ally_idx ON deals (ally_id);
CREATE INDEX contacts_ally_idx ON contacts (ally_id);
