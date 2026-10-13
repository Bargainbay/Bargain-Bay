-- What a unit's tracker Status was BEFORE a sale overwrote it with Sold.
--
-- A unit now goes Sold on the FIRST payment, including a deposit, and that can
-- happen to a unit that is still Untested or in cleaning. If the payment is later
-- taken back, the unit must return to what it was -- not to "Tested Working",
-- which would put an untested machine on the shop floor's sellable list.
-- One row per unit, deleted when the sale is reversed.
CREATE TABLE IF NOT EXISTS sale_prior_status (
  sku          text PRIMARY KEY,
  prior_status text NOT NULL,
  set_at       timestamptz NOT NULL DEFAULT now()
);
