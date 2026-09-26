-- Gastos de operación (marketing, planes móviles, etc.), ingresados a mano por el admin.
-- Se descuentan en el Balance financiero para obtener la ganancia real del mes.
CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  category    TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  created_by  TEXT,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_period_idx ON expenses (year, month);
