-- How a partner is paid: a share of PROFIT (default), or a share of the sale PRICE capped at a share of the profit.
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS commission_basis text NOT NULL DEFAULT 'profit';
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_pct numeric(5,2) NOT NULL DEFAULT 8;
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_pct_retail numeric(5,2) NOT NULL DEFAULT 6;
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_cap_pct numeric(5,2) NOT NULL DEFAULT 35;
