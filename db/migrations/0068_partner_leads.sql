-- Partner leads (phase 2 of the Aljo Systems lead-generator program). A lead a partner's generator sends us is an ordinary
-- row in the Sales Hub's `leads` table, tagged with who sent it, so our reps work it with the tools they already have.
--
-- partner_email / partner_member_email: the organisation and the generator who sent it (NULL for every other lead).
-- submitted_at: when it was sent. FIRST IN TIME WINS a duplicate, so this is the proof of order.
-- how_reached / intake: how the person contacted the generator, and form vs screenshot (screenshot arrives in phase 4).
-- notified_at / reminded_at: so 20 generators cannot produce 200 emails to the sales team.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_email text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_member_email text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS how_reached text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_member_email text;

CREATE INDEX IF NOT EXISTS idx_leads_partner ON leads (partner_email, partner_member_email) WHERE partner_email IS NOT NULL;
-- The database refuses the second partner lead for one person even if two requests race past the application's check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_partner_phone ON leads (phone_key) WHERE partner_email IS NOT NULL AND phone_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_partner_email ON leads (lower(email)) WHERE partner_email IS NOT NULL AND email IS NOT NULL;

-- What a generator is told: a lead was received, a lead was refused as a duplicate. Kept so closing the tab loses nothing.
CREATE TABLE IF NOT EXISTS partner_notices (
  id            serial PRIMARY KEY,
  partner_email text NOT NULL,
  member_email  text NOT NULL,
  kind          text NOT NULL,
  lead_id       integer,
  text          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  seen_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_partner_notices_member ON partner_notices (member_email, created_at DESC);

-- Every refused duplicate, so "I sent it first" can be answered with a timestamp.
CREATE TABLE IF NOT EXISTS partner_dup_attempts (
  id               serial PRIMARY KEY,
  partner_email    text NOT NULL,
  member_email     text NOT NULL,
  name             text,
  phone_key        text,
  email            text,
  existing_lead_id integer,
  existing_kind    text,
  same_member      boolean NOT NULL DEFAULT false,
  same_org         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_dup_partner ON partner_dup_attempts (partner_email, created_at DESC);
