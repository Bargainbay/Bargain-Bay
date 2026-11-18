-- A bank balance typed in from the TD app, for when the bank feed is down. Widens the entry kinds (the till
-- 'count' kind was only ever added at runtime, so it is named here too) and lets a bank balance be zero or negative.
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_kind_check;
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_amount_check;
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_kind_check CHECK (kind IN ('cash', 'pending', 'count', 'bank'));
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_amount_check CHECK (kind IN ('count', 'bank') OR amount <> 0);
