-- Carts we can put a name to.
--
-- The cart lives in the browser (lib/cart.js, localStorage) and the pixel
-- carries no identity, so nothing server-side knew who added a unit and then
-- left. A row here exists ONLY once the shopper is identifiable: signed in, or
-- an email / phone typed on /checkout. An anonymous cart is never stored.
--
-- `token` is a random id the browser mints and keeps; it is how one browser's
-- successive updates land on one row. `skus` is the cart as last seen. A cart
-- is "closed" when the browser reports it empty (cleared after an order, or
-- every unit removed); a later non-empty update reopens it as a fresh cart.
--
-- `tasked_at` / `customer_id` record that a CRM follow-up was raised, so the
-- same cart is not raised twice. Nothing here is ever sent to the shopper:
-- this is a staff to-do list, not a marketing audience (CASL).
CREATE TABLE IF NOT EXISTS cart_sessions (
  id          serial PRIMARY KEY,
  token       text NOT NULL,
  email       text,
  phone       text,
  phone_key   text,
  name        text,
  user_id     int,
  skus        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  tasked_at   timestamptz,
  customer_id int,
  CONSTRAINT cart_sessions_identifiable CHECK (email IS NOT NULL OR phone_key IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cart_sessions_token ON cart_sessions (token);
CREATE INDEX IF NOT EXISTS cart_sessions_open ON cart_sessions (updated_at) WHERE closed_at IS NULL;
