-- The Voice Manager: an agent that rings the owner about what is wrong with the
-- business (lib/manager-call.js). One row per call, and the owner's own to-dos.
--
-- Also created at runtime by ensureManagerSchema(), so the first call works before
-- anybody presses Run schema migration. Both are IF NOT EXISTS, so either order is
-- fine.
CREATE TABLE IF NOT EXISTS manager_calls (
  id           serial PRIMARY KEY,
  call_sid     text,
  to_number    text,
  trigger      text NOT NULL DEFAULT 'manual',   -- 'cron' | 'manual'
  status       text NOT NULL DEFAULT 'placed',   -- placed | answered | done | voicemail
  issues       jsonb NOT NULL DEFAULT '[]'::jsonb, -- what the scan found when the call started
  log          jsonb NOT NULL DEFAULT '[]'::jsonb, -- short transcript: context for the next turn
  actions      jsonb NOT NULL DEFAULT '[]'::jsonb, -- what the agent actually DID, in order
  pending      jsonb,                              -- a write proposed and waiting for a second yes
  turns        int NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  ended_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_manager_calls_started ON manager_calls(started_at DESC);

CREATE TABLE IF NOT EXISTS manager_notes (
  id         serial PRIMARY KEY,
  body       text NOT NULL,
  call_id    int,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz
);
