-- A "through the bank, not showing yet" entry can say what it is and who it went to, so when the bank finally shows the
-- line it is categorised and named without anyone retyping it.
ALTER TABLE bankroll_entries ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE bankroll_entries ADD COLUMN IF NOT EXISTS payee text;
