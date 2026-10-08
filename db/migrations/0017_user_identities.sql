-- "Sign in with Google / Microsoft".
--
-- One row per external identity. `subject` is the provider's own stable id for
-- the person (Google `sub`, Microsoft `oid`/`sub`) -- NOT the email, which a
-- person can change. The pair (provider, subject) is what proves it is the same
-- human next time; the email is only used the FIRST time, to attach the identity
-- to an account that already exists.
--
-- A user may have several (Google and Hotmail), and a user created this way has
-- an unusable password_hash until they set one through "forgot password".
CREATE TABLE IF NOT EXISTS user_identities (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    text NOT NULL,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_subject ON user_identities (provider, subject);
CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);
