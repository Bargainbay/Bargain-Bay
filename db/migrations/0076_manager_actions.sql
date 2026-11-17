-- What the manager DID on its own or on the owner's instruction, so it can be
-- reported afterwards and undone from the screen it touched (lib/manager-actions.js).
CREATE TABLE IF NOT EXISTS manager_actions (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  via text NOT NULL DEFAULT 'auto',        -- auto (unattended) | voice (owner told it to)
  dedupe_key text,
  reported_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_actions_dedupe ON manager_actions (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manager_actions_at ON manager_actions (at DESC);
