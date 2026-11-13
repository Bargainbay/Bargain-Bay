-- Lead-generator program (Aljo Systems): a referral partner organisation may have LEAD GENERATORS, logins that see only
-- the leads they send themselves and never any money. Phase 1 = the role and the switch.
--
-- partner_members.role: 'admin' (today's behaviour: sees the whole organisation) or 'affiliate' (a lead generator).
-- Every existing row is an admin, so SecondShop's teammates see exactly what they saw before.
-- referral_partners.generators: ON by default for every organisation (owner, 2026-11-12: organisations add their own generators,
-- nobody here has to enable anything). It is the owner's kill switch for one organisation, not a setup step.
-- referral_partners.lead_pct: the % of PROFIT paid when one of our reps closes a sale from this partner's leads.
ALTER TABLE partner_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS generators boolean NOT NULL DEFAULT true;
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS lead_pct numeric(5,2) NOT NULL DEFAULT 10;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_members_role_check') THEN
    ALTER TABLE partner_members ADD CONSTRAINT partner_members_role_check CHECK (role IN ('admin', 'affiliate'));
  END IF;
END $$;
