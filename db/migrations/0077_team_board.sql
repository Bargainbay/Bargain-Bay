-- Team board: one chat and one post board per channel (general, sales, warehouse, delivery).
-- Channels are a fixed list in lib/team-board-rules.js, not rows, so nobody can create a
-- sixth by accident and the access rules stay in one place.
-- A member is a KEY, not a foreign key: `user:<id>` for anyone with an account here, and
-- `rsops:<name>` for RS Ops crew who sign in there by PIN and have no account.
CREATE TABLE IF NOT EXISTS team_messages (
  id          bigserial PRIMARY KEY,
  channel     text NOT NULL CHECK (channel IN ('general','sales','warehouse','delivery')),
  kind        text NOT NULL CHECK (kind IN ('chat','post')),
  title       text,
  body        text NOT NULL,
  author_key  text NOT NULL,
  author_name text NOT NULL,
  pinned_at   timestamptz,
  pinned_by   text,
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'chat' OR title IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_team_messages_feed ON team_messages (channel, kind, id DESC);
CREATE INDEX IF NOT EXISTS idx_team_messages_author ON team_messages (author_key, created_at);

-- Where each person has read up to, per channel and per kind. One row, moved forward only.
CREATE TABLE IF NOT EXISTS team_reads (
  member_key   text NOT NULL,
  channel      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('chat','post')),
  last_read_id bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_key, channel, kind)
);

-- "Got it" on a post: who has seen an important notice, and when.
CREATE TABLE IF NOT EXISTS team_post_acks (
  message_id  bigint NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  member_key  text NOT NULL,
  member_name text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, member_key)
);
