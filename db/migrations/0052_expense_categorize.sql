-- Categorising bank lines at scale: who the money went to, what the bank said,
-- which account it came out of, and whether a person has looked at it.
--
-- bank        everything useful Plaid sent (counterparties, payment_meta, the original
--             description, its own category guess) so nothing is thrown away.
-- payee       what the bank/merchant says. payee_override is what a PERSON typed
--             ("sent to"); it wins, and the sync never overwrites it.
-- cat_source  rule | guess | manual | bulk | qbo. manual/bulk are decisions and are never
--             overwritten by the bank feed.
-- reviewed_at NULL = still needs a person's eyes. Everything that did not come from the
--             bank feed was entered or categorised by someone, so it counts as reviewed.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payee text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payee_override text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_desc text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS memo text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS user_note text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank jsonb;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_label text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cat_source text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_by text;
CREATE INDEX IF NOT EXISTS idx_expenses_to_review ON expenses (incurred_on DESC) WHERE reviewed_at IS NULL;

UPDATE expenses
   SET reviewed_at = COALESCE(created_at, now()),
       cat_source = CASE WHEN COALESCE(source, 'manual') = 'qbo' THEN 'qbo' ELSE 'manual' END
 WHERE COALESCE(source, 'manual') <> 'plaid' AND reviewed_at IS NULL;

-- One list of categories across the Costs section and the bank feed: the two
-- names that said the same thing in both places are merged.
UPDATE expenses SET category = 'Advertising' WHERE category = 'Marketing';
UPDATE expenses SET category = 'Card & bank fees' WHERE category = 'Fees';
UPDATE expense_rules SET category = 'Advertising' WHERE category = 'Marketing';
UPDATE expense_rules SET category = 'Card & bank fees' WHERE category = 'Fees';
