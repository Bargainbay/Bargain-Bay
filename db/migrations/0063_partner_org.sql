-- A referral partner is an ORGANISATION (e.g. SecondShop) with several logins, and has two links:
-- one for resellers, one for end users that carries a coupon code for a further discount.
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS customer_pct numeric(5,2) NOT NULL DEFAULT 5;
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS customer_coupon_id integer;
-- Everyone who may sign in to a partner's portal besides the primary login. Removing keeps the row.
CREATE TABLE IF NOT EXISTS partner_members (
  member_email  text PRIMARY KEY,
  partner_email text NOT NULL,
  name          text,
  added_by      text,
  added_at      timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz,
  removed_by    text
);
CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members (partner_email);
