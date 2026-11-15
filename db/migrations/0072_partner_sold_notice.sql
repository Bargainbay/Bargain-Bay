-- Remembers that a lead generator has been told their lead bought (once only). Also created at runtime by ensurePartnerLeadSchema.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sold_notified_at timestamptz;
