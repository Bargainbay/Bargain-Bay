-- A lead brought across from RS Ops' sales CRM remembers which RS Ops lead it was
-- (lib/rsops-leads.js). The partial unique index is what makes the move safe to
-- run twice, or in batches: the same RS Ops lead can never land in the Hub twice.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rsops_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_rsops_id ON leads (rsops_id) WHERE rsops_id IS NOT NULL;
