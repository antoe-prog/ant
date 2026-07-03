-- Runtime JSONB state used by the Next.js MVP route handlers before the full
-- normalized service layer is switched on.

CREATE TABLE IF NOT EXISTS app_runtime_state (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_app_runtime_state_updated_at ON app_runtime_state (updated_at);
