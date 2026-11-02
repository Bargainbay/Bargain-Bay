-- cron_daily: one row per scheduled job per Toronto day, counting runs and failures.
--
-- cron_heartbeats keeps only the LAST run of each job, which is right for "is it alive
-- now" and useless for "how reliable has it been". The Agent village levels its
-- buildings up from clean days, and a clean-day streak needs history. Written from
-- recordHeartbeat (best-effort: a missing table never fails a job). History starts the
-- day this ships; nothing is backfilled because nothing recorded it.
CREATE TABLE IF NOT EXISTS cron_daily (
  name  text NOT NULL,
  day   date NOT NULL,
  runs  integer NOT NULL DEFAULT 0,
  fails integer NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day)
);
