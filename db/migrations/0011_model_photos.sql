-- The stock photo for a MODEL, editable without a deploy.
--
-- data/images.json was the only place a model's photo could live, so adding one
-- meant a code change and a deploy, and nothing forced anybody to do it: 28
-- models on the shop showed placeholder art on 2026-10-05. This table sits IN
-- FRONT of that file — a row here wins, the file is the fallback — so the
-- hundreds of existing entries keep working and nothing has to be migrated.
--
-- `model` is the EXACT string the tracker spells (no trimming, no case folding),
-- the same rule data/images.json has always followed.
CREATE TABLE IF NOT EXISTS model_photos (
  model      text PRIMARY KEY,
  url        text NOT NULL,
  -- Set only when we hold the file ourselves (private Blob store). NULL for a
  -- pasted link, which is why removing one never deletes anybody else's file.
  path       text,
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
