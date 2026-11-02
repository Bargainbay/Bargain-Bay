-- Which business an ad-spend row belongs to (bargain_bay | rs_solutions). NULL = not assigned yet.
ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS brand text;
CREATE INDEX IF NOT EXISTS idx_ad_spend_brand ON ad_spend (brand, spent_on);
