-- When the Manager last pushed somebody about today's target, how often, and whether
-- they have been told they hit it (lib/exec.js). Also added by ensureExecSchema().
ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS pushes integer NOT NULL DEFAULT 0;
ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS cheered_at timestamptz;
