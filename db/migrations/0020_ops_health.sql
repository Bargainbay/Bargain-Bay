-- Two small tables for the ops-health work.
--
-- cron_heartbeats: Vercel exposes no per-run history for cron jobs, so "is it
-- firing" and "is it working" were both unanswerable. Each scheduled route now
-- records its own last run here, and the daily health email reads it.
--
-- offsite_backup_blobs: which Vercel Blob objects have already been copied to the
-- off-site Drive folder, so each hourly pass uploads only what is new.

CREATE TABLE IF NOT EXISTS cron_heartbeats (
  name         text PRIMARY KEY,
  last_run_at  timestamptz NOT NULL,
  last_ok_at   timestamptz,
  last_status  integer,
  last_error   text,
  runs         bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS offsite_backup_blobs (
  pathname     text NOT NULL,
  uploaded_at  timestamptz NOT NULL,
  size_bytes   bigint,
  drive_id     text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pathname, uploaded_at)
);
