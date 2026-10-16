-- The Halloween giveaway's costume contest.
--
-- An entrant may send ONE photo of their costume. Staff look at it (approved or
-- rejected, like a video was) and then choose the single best costume, which
-- earns +5 entries. Only the best costume earns anything: sending a photo is not
-- itself a ticket, so `costume_status` never feeds the ticket count.
--
-- The photo sits in the private Blob store; only the path is kept. The release
-- box must have been ticked: that tick is our permission to show it.
ALTER TABLE giveaway_entries
  ADD COLUMN IF NOT EXISTS costume_path        text,
  ADD COLUMN IF NOT EXISTS costume_status      text
    CHECK (costume_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS costume_release     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS costume_at          timestamptz,
  ADD COLUMN IF NOT EXISTS costume_reviewed_by text,
  ADD COLUMN IF NOT EXISTS costume_best        boolean NOT NULL DEFAULT false;

-- "The best costume" is ONE entry per giveaway, and the database says so, so two
-- people on the screen cannot both be it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_giveaway_one_best_costume
  ON giveaway_entries (giveaway) WHERE costume_best;
