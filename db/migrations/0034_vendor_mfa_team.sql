-- Vendor team roles and two-factor sign-in (TOTP) for the vendor portal.
-- See CLAUDE.md "The marketplace" and lib/vendor-permissions.js, lib/vendor-mfa.js.

-- Roles. The old two-value CHECK (owner, staff) is replaced; every existing 'staff' row becomes
-- 'manager', which is what 'staff' could already do (everything except the bank account and the
-- policies). Drop the CHECK first or the UPDATE below is refused.
ALTER TABLE vendor_users DROP CONSTRAINT IF EXISTS vendor_users_role_check;
UPDATE vendor_users SET role = 'manager' WHERE role = 'staff';
ALTER TABLE vendor_users ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE vendor_users
  ADD CONSTRAINT vendor_users_role_check CHECK (role IN ('owner','manager','listings','fulfilment','viewer'));

-- When the grace period for MFA ends (14 days from the grant). A DEFAULT, so any insert path gets
-- one, and ADD COLUMN evaluates it once, so every existing row gets 14 days from deploy.
ALTER TABLE vendor_users ADD COLUMN IF NOT EXISTS mfa_grace_until timestamptz NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE vendor_users ADD COLUMN IF NOT EXISTS role_changed_by text;
ALTER TABLE vendor_users ADD COLUMN IF NOT EXISTS role_changed_at timestamptz;

-- One authenticator per user (keyed by the users row, not the vendor: the same person signs in
-- the same way whichever vendor they act for). `secret_enc` is lib/secret-box.js ciphertext with
-- the user id as AAD. confirmed_at NULL = enrolment started and not finished: it protects nothing.
-- last_step is the newest 30-second step already accepted: a code cannot be used twice.
CREATE TABLE IF NOT EXISTS vendor_mfa (
  user_id      integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc   text NOT NULL,
  confirmed_at timestamptz,
  last_step    bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Single-use recovery codes, stored as a salted SHA-256, never the code. Rows are kept once used.
CREATE TABLE IF NOT EXISTS vendor_mfa_recovery (
  id        serial PRIMARY KEY,
  user_id   integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_mfa_recovery_user ON vendor_mfa_recovery (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_mfa_recovery_hash ON vendor_mfa_recovery (user_id, code_hash);

-- Every code attempt, for the lockout. Counted in Postgres: serverless instances share no memory.
CREATE TABLE IF NOT EXISTS vendor_mfa_attempts (
  id      bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      timestamptz NOT NULL DEFAULT now(),
  ok      boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_mfa_attempts_user ON vendor_mfa_attempts (user_id, at DESC);
