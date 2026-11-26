-- Who a campaign email was sent to, and whether it went. One row per campaign key + address, so a
-- campaign that was cut short (provider rate limit, timeout) can be resumed without emailing anyone twice.
CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_key text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  error text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_key, email)
);
