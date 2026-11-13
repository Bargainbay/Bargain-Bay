-- Phase 5 of the lead-generator program: the posting kit and the nightly take-down list.
-- affiliate_posts: "I posted this", per login and unit, in the database (20 people, several devices; browser storage is not a record).
--   gone_at is when we first saw a posted unit stop being for sale; taken_down_at is when they said they took it down.
-- stock_daily: a tiny nightly snapshot of what was for sale, so "new since last night" is a comparison (products has no arrival date).
-- partner_digests: one row per recipient per day, claimed BEFORE sending so the nightly email can never go twice.
CREATE TABLE IF NOT EXISTS affiliate_posts (
  id            serial PRIMARY KEY,
  partner_email text NOT NULL,
  member_email  text NOT NULL,
  sku           text NOT NULL,
  posted_at     timestamptz NOT NULL DEFAULT now(),
  gone_at       timestamptz,
  taken_down_at timestamptz,
  UNIQUE (member_email, sku)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_posts_partner ON affiliate_posts (partner_email);
CREATE TABLE IF NOT EXISTS stock_daily (
  day      date PRIMARY KEY,
  skus     text[] NOT NULL DEFAULT '{}',
  n        integer NOT NULL DEFAULT 0,
  taken_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_digests (
  member_email text NOT NULL,
  day          date NOT NULL,
  kind         text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_email, day)
);
