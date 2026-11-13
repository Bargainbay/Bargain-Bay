-- Phase 3 of the lead-generator program: each lead generator gets their OWN discount code (a coupon), so a sale made with it is
-- credited to the organisation AND to them. The coupon id is kept so the code can be switched off when they are removed and its
-- discount kept in step with the organisation's customer discount. The code itself is stable (it does not carry the percentage).
ALTER TABLE partner_members ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE partner_members ADD COLUMN IF NOT EXISTS coupon_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_members_code ON partner_members (lower(code)) WHERE code IS NOT NULL;
-- Which generator a customer is credited to (set through a lead or a generator's code). Also added by migration 0068.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_member_email text;
