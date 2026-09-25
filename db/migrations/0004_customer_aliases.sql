-- Merging two customer records.
--
-- WHY THIS IS NOT LIKE mergeDrivers. A driver's work is linked by a real
-- foreign key (jobs.driver_id), so merging them is a handful of UPDATEs. NOTHING
-- carries a customer_id: orders, invoices and quotes are matched to a customer
-- by their EMAIL ADDRESS. So merging cannot move rows — the survivor has to
-- absorb the other record's IDENTITIES, and every lookup has to see through
-- them.
--
-- Same shape as client_aliases, which dispatch already uses to learn that
-- "CDA" and "Canadian Discount Appliances" are one company.
--
-- 2.1 made duplicates possible on purpose: the phone is only an identity for a
-- record with no email, so two family members sharing a landline stay two
-- customers. This is the other half of that decision — the cleanup for when
-- they genuinely are one person.
CREATE TABLE IF NOT EXISTS customer_aliases (
  id               serial PRIMARY KEY,
  customer_id      int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('email', 'phone')),
  value            text NOT NULL,            -- lowercased email, or E.164 phone
  -- Deliberately NOT a foreign key: the record it came from is deleted by the
  -- merge, and this is the note saying where it went. A constraint would either
  -- block the delete or erase the trail.
  from_customer_id int,
  note             text,
  merged_by        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ONE customer per identity, globally. Without this a merge could point the
-- same address at two records and the next lookup would pick whichever the
-- planner felt like.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_alias_value
  ON customer_aliases (kind, value);

CREATE INDEX IF NOT EXISTS idx_customer_alias_customer
  ON customer_aliases (customer_id);
