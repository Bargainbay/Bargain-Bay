-- Entries to a prize giveaway.
--
-- One row per person per giveaway. `entry_key` is the email with any +tag
-- stripped and lowercased, because "me+1@x.com" and "me+2@x.com" are one inbox
-- and a draw where one person holds twenty tickets is not a fair draw. The
-- address they TYPED is kept in `email`, since that is what we write to.
--
-- Marketing consent is NOT stored here. Entering a giveaway cannot be made
-- conditional on agreeing to marketing (CASL), so consent is its own optional,
-- unticked checkbox and its record is a `consent_events` row with the wording
-- shown, exactly as at checkout. `marketing_opt_in` only remembers what they
-- ticked, so the admin screen can say it without joining.
CREATE TABLE IF NOT EXISTS giveaway_entries (
  id               serial PRIMARY KEY,
  giveaway         text NOT NULL,
  name             text NOT NULL,
  email            text NOT NULL,
  entry_key        text NOT NULL,
  phone            text,
  postal_prefix    text,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  ip               text,
  user_agent       text,
  -- entered -> winner -> (forfeited | claimed). Only 'entered' can be drawn, so
  -- redrawing never reaches back to somebody already chosen or struck off.
  status           text NOT NULL DEFAULT 'entered'
                   CHECK (status IN ('entered','winner','forfeited','claimed')),
  drawn_at         timestamptz,
  drawn_by         text,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_giveaway_one_entry
  ON giveaway_entries (giveaway, entry_key);
CREATE INDEX IF NOT EXISTS idx_giveaway_ip ON giveaway_entries (giveaway, ip, created_at);
