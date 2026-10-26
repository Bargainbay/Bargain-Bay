-- Affiliates: people who promote our stock in their own way and earn a percentage of the goods on every
-- sale made with their code. The CODE is an ordinary coupon (it has to be: the checkout, the redemption
-- booking and the abandoned-order release all already run through coupons); this table is the PERSON,
-- their approval, where to pay them, and what has been paid. What they have EARNED is never stored: it is
-- read off coupon_redemptions + orders (see lib/affiliates.js), so it cannot drift from the sales.

-- coupon_redemptions is created at runtime and carried verbatim by 0023; repeated here so this file reads
-- on its own and is a no-op on a database that has it.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id         serial PRIMARY KEY,
  coupon_id  int NOT NULL,
  code       text NOT NULL,
  affiliate  text,
  order_id   int,
  email      text,
  subtotal   numeric(10,2),
  discount   numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The rate in force WHEN the code was used.
ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2);

CREATE TABLE IF NOT EXISTS affiliates (
  id               serial PRIMARY KEY,
  email            text NOT NULL,                       -- the account's email, lowercase: the identity
  name             text NOT NULL,
  phone            text,
  payout_email     text,                                -- the e-transfer address; theirs to change
  audience         text,                                -- how they plan to promote (what they told us)
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','suspended','rejected')),
  coupon_id        int,                                 -- their code (a coupons row), set at approval
  code             text,
  commission_pct   numeric(5,2) NOT NULL DEFAULT 5,
  terms_version    text,
  terms_accepted_at timestamptz,
  approved_by      text,
  approved_at      timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_code  ON affiliates (upper(code)) WHERE code IS NOT NULL;

-- Money that has actually left, one row per e-transfer. Append-only in spirit: a mistake is corrected
-- with a new row, not an edit. `ref` (the e-transfer reference) is unique per affiliate when given, so a
-- double click cannot pay the same transfer twice.
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id           serial PRIMARY KEY,
  affiliate_id int NOT NULL REFERENCES affiliates(id),
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  method       text NOT NULL DEFAULT 'e-transfer',
  ref          text,
  note         text,
  paid_by      text,
  paid_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_payouts_ref ON affiliate_payouts (affiliate_id, lower(ref)) WHERE ref IS NOT NULL;
