-- Documentos adjuntos de cada negocio (cédula, diploma, acta de grado y otros).
-- El archivo se guarda dentro de la base de datos: el servidor web de Render no tiene disco
-- permanente, así que un archivo guardado en disco se perdería en cada reinicio.
CREATE TABLE deal_documents (
  id               TEXT PRIMARY KEY,
  deal_id          TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  doc_type         TEXT NOT NULL CHECK (doc_type IN ('cedula', 'diploma', 'acta_grado', 'otro')),
  file_name        TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0),
  data             BYTEA NOT NULL,
  uploaded_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_documents_deal_idx ON deal_documents (deal_id);
