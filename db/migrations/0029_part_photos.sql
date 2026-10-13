-- Pictures of a part. Keyed by part (the catalogue row), not by piece: one photo
-- shows what the part IS, and the same row is what a parts website will list.
-- Files live in the private Blob store under parts/<part id>-<n>.jpg and are
-- served through /api/part-photo/<id>.
CREATE TABLE IF NOT EXISTS part_photos (
  id         serial PRIMARY KEY,
  part_id    int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  path       text NOT NULL,
  position   int NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_part_photos_part ON part_photos(part_id, position, id);
