-- Bonus entries for the giveaway: an Instagram handle and a "what I'm thankful
-- for" video.
--
-- The other bonus steps need NO column, on purpose: having an account is a fact
-- about `users`, and being subscribed is a fact about `consent_events`. Storing
-- either here would be a second copy that drifts the moment someone unsubscribes
-- or signs up later with the same address.
--
-- The video sits in the private Blob store; only the path is kept. It counts
-- only once an admin has approved it (status 'approved'), and the release box
-- must have been ticked: that tick is our permission to show it.
ALTER TABLE giveaway_entries
  ADD COLUMN IF NOT EXISTS instagram_handle   text,
  ADD COLUMN IF NOT EXISTS video_path         text,
  ADD COLUMN IF NOT EXISTS video_status       text
    CHECK (video_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS video_release      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_at           timestamptz,
  ADD COLUMN IF NOT EXISTS video_reviewed_by  text;
