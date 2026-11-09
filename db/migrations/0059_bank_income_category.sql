-- What a piece of money coming IN was, picked by a person on the live bankroll list. Income is not an expense, so it
-- is labelled on the bank line itself and never turned into an expense row.
ALTER TABLE bank_activity ADD COLUMN IF NOT EXISTS income_category text;
