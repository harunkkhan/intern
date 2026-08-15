-- Move company sources onto the workflow's 5-minute loop cadence.
--
-- The builtin sources in internships/src/sources/index.ts are upserted on every
-- poll by ensureBuiltinSources, so they correct themselves from code and are
-- excluded here — that also protects the two deliberate outliers, NSF REU (360)
-- and Microsoft Research (60), from being sped up by a blanket update.
--
-- Everything else was written once by register-sources.ts at registration time
-- and is never refreshed, so the scraped (30) and ATS (10) rows already in the
-- table need this update to actually change cadence. Changing the defaults in
-- register-sources.ts only affects the next run of that script.
UPDATE "job_source"
SET "poll_interval_minutes" = 5
WHERE "poll_interval_minutes" > 5
  AND "label" NOT IN (
    'SimplifyJobs',
    'vanshb03',
    'underclassmen-opportunities',
    'underclassmen-internships',
    'NSF REU',
    'Microsoft Research'
  );
