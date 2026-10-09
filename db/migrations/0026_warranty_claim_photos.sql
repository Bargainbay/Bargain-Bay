-- Photos on a warranty claim: the fault as the customer showed it (staff attach them), and the repair or
-- replacement as the seller shows it. Files live in the private Blob store, re-encoded with no EXIF/GPS.
-- Both sides can see all of a claim's photos (the seller needs to see the fault); nothing here is customer
-- contact data.
CREATE TABLE IF NOT EXISTS warranty_claim_photos (
  id          serial PRIMARY KEY,
  claim_id    integer NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('staff','vendor')),
  blob_path   text NOT NULL,
  caption     text,
  width       integer, height integer, bytes integer,
  uploaded_by text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_claim_photos_claim ON warranty_claim_photos (claim_id);
