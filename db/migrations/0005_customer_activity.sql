-- The two things that turn a customer record into something a person can work
-- from: what was said, and what happens next.
--
-- Before this the CRM was a read-only history. It could tell you what somebody
-- had bought and nothing about the conversation — and there was no way at all
-- to write down "call them Thursday", which is the single thing a salesperson
-- needs a CRM for. `customers.notes` was one text blob: no author, no date, and
-- the second person to edit it silently overwrote the first.

-- ---------------------------------------------------------------------------
-- What was said. APPEND-ONLY — an activity log that can be edited is a log
-- nobody can rely on. Corrections are a new entry.
CREATE TABLE IF NOT EXISTS customer_activity (
  id          serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('note', 'call', 'email', 'sms', 'visit', 'system')),
  body        text NOT NULL,
  -- The email is the stable identity (it matches the SALES_EMAILS gate); the
  -- name is snapshotted so the record survives a rename or a departure. Same
  -- reasoning as invoices.created_by / created_by_name.
  by_email    text,
  by_name     text,
  -- When it HAPPENED, which is not always when it was typed: a call logged the
  -- next morning still happened yesterday.
  at          timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, at DESC);

-- ---------------------------------------------------------------------------
-- What happens next.
CREATE TABLE IF NOT EXISTS customer_tasks (
  id           serial PRIMARY KEY,
  customer_id  int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title        text NOT NULL,
  note         text,
  -- A DATE, not a timestamp. Nobody says "call them at 14:32"; they say
  -- Thursday. A time would be precision this never has and would make "due
  -- today" depend on the hour.
  due_on       date,
  -- NULL is a real state: a follow-up nobody has picked up. It must be visible
  -- rather than hidden, which is why "My day" lists unowned tasks too.
  owner_email  text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz,
  done_by      text,
  -- Why it was closed without being done. A follow-up that was dropped on
  -- purpose and one that was forgotten look identical without this.
  outcome      text
);
CREATE INDEX IF NOT EXISTS idx_customer_tasks_open
  ON customer_tasks (due_on, owner_email) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_tasks_customer
  ON customer_tasks (customer_id, created_at DESC);
