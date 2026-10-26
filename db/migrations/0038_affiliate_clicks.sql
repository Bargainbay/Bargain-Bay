-- Visits that arrived through an affiliate's link (?ref=CODE). One row per visitor per day per affiliate:
-- the UNIQUE index is what makes a refresh, a reload loop or a bot hammering one id free, and "clicks" means
-- distinct visitor-days, which is the honest number (a raw hit count is how a page refresh pays out).
-- `visitor` is a random id the browser made up and keeps in localStorage. It is NOT an IP address, a cookie
-- shared with anything else, or anything that identifies a person; clearing storage is a new visitor.
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id           bigserial PRIMARY KEY,
  affiliate_id int NOT NULL REFERENCES affiliates(id),
  day          date NOT NULL,
  visitor      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_clicks_visit ON affiliate_clicks (affiliate_id, day, visitor);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_recent ON affiliate_clicks (affiliate_id, created_at DESC);
