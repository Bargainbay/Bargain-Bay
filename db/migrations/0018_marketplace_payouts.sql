-- Vendor bank details and the payout ledger. See docs/marketplace/PLAN.md §8.2 and §13.4.
--
-- Two rules shape everything here:
--   * A vendor's balance is NEVER a stored number. It is the SUM of an append-only
--     ledger, so two people cannot quietly disagree about what is owed and "where did
--     that money go" always has an answer.
--   * An account number is never stored in the clear. Only the last four digits are
--     readable without the key.

-- The first payout to a vendor is cleared by hand (a small test deposit or a call).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS first_payout_cleared_at timestamptz;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS first_payout_cleared_by text;

CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
  id            serial PRIMARY KEY,
  vendor_id     integer NOT NULL REFERENCES vendors(id),
  holder_name   text NOT NULL,
  institution   text NOT NULL CHECK (institution ~ '^[0-9]{3}$'),
  transit       text NOT NULL CHECK (transit ~ '^[0-9]{5}$'),
  -- AES-256-GCM, bound to the vendor id. See lib/secret-box.js.
  account_enc   text NOT NULL,
  account_last4 text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  method        text NOT NULL DEFAULT 'direct_deposit' CHECK (method IN ('direct_deposit','wire')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_at   timestamptz,
  verified_by   text,
  verified_how  text CHECK (verified_how IS NULL OR verified_how IN ('void_cheque','bank_letter','test_deposit')),
  -- Staff attest that the holder's name matches the vendor's legal or trading name.
  name_matched  boolean,
  -- A CHANGED account is not paid to until this passes (account-takeover defence).
  cooling_until timestamptz,
  reject_reason text,
  submitted_by  text,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_verified_complete CHECK (
    status <> 'verified' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL
                             AND verified_how IS NOT NULL AND name_matched IS TRUE AND cooling_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS vendor_bank_accounts_vendor ON vendor_bank_accounts (vendor_id, status);

-- Append-only. Corrections are new rows. Which side of zero each kind may sit on is
-- enforced here, so a bug in a caller cannot, say, record a commission as a credit.
CREATE TABLE IF NOT EXISTS vendor_ledger (
  id            bigserial PRIMARY KEY,
  vendor_id     integer NOT NULL REFERENCES vendors(id),
  kind          text NOT NULL CHECK (kind IN (
                  'sale','lane_c_delivery','commission','delivery_service_fee','insurance',
                  'warranty_hold','warranty_release','refund','guarantee_claim','chargeback',
                  'adjustment','payout','payout_reversal')),
  amount_cents  bigint NOT NULL,
  order_ref     text,
  ref           text,
  memo          text,
  actor         text,
  at            timestamptz NOT NULL DEFAULT now(),
  -- when this money becomes payable: delivery + the tier's hold. Everything from one
  -- order's settlement shares it, so the order nets to its true figure or not at all.
  available_at  timestamptz NOT NULL DEFAULT now(),
  -- makes appending idempotent: a retried settlement cannot pay twice.
  idem_key      text,
  CONSTRAINT vendor_ledger_sign CHECK (
    amount_cents <> 0 AND CASE
      WHEN kind IN ('sale','lane_c_delivery','warranty_release','payout_reversal') THEN amount_cents > 0
      WHEN kind IN ('commission','delivery_service_fee','insurance','warranty_hold','refund',
                    'guarantee_claim','chargeback','payout') THEN amount_cents < 0
      ELSE TRUE END),
  CONSTRAINT vendor_ledger_adjustment_memo CHECK (kind <> 'adjustment' OR length(btrim(COALESCE(memo,''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_ledger_idem ON vendor_ledger (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_ledger_vendor ON vendor_ledger (vendor_id, available_at);
CREATE INDEX IF NOT EXISTS vendor_ledger_order ON vendor_ledger (order_ref);

CREATE OR REPLACE FUNCTION vendor_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'vendor_ledger is append-only: record a correcting entry instead';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendor_ledger_no_change ON vendor_ledger;
CREATE TRIGGER vendor_ledger_no_change BEFORE UPDATE OR DELETE ON vendor_ledger
  FOR EACH ROW EXECUTE FUNCTION vendor_ledger_append_only();

-- A payout is PROPOSED by the system or an admin, then APPROVED by an admin (nothing is
-- paid without a yes). The ledger entry is written at approval, in the same transaction.
CREATE TABLE IF NOT EXISTS vendor_payouts (
  id              serial PRIMARY KEY,
  vendor_id       integer NOT NULL REFERENCES vendors(id),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  status          text NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','approved','paid','failed','cancelled')),
  bank_account_id integer REFERENCES vendor_bank_accounts(id),
  method          text,
  proposed_by     text NOT NULL,
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  approved_by     text,
  approved_at     timestamptz,
  paid_at         timestamptz,
  paid_ref        text,
  note            text
);
-- One open payout per vendor, so a rerun of the proposal cannot stack a second.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_payouts_open
  ON vendor_payouts (vendor_id) WHERE status IN ('proposed','approved');
CREATE INDEX IF NOT EXISTS vendor_payouts_status ON vendor_payouts (status, proposed_at);
