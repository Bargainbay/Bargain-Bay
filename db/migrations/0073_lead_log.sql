-- The lead log: the everyday inbound leads (phone, Facebook, partners, lead-generation teams) and what each buyer asked for.
--
-- Built on the Sales Hub's `leads` table rather than beside it. Three plain columns:
--   wanted           what they asked for, as the person logging it heard it ("LG 36in French door", "any 30in range")
--   wanted_category  the bucket for that (a fixed list, so "what did we not have" can be counted)
--   source_detail    WHICH partner or team sent it ("SecondShop", "Aljo", a generator's name)
-- "No stock" is a lost reason (lead-rules.js), not a column: it is one answer to "why did this not become a sale".
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wanted          text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wanted_category text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_detail   text;

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
