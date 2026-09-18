-- job_listing.dedupe_key and alert_delivery.dedupe_key move to the requisition
-- id parsed out of the apply URL. See jobIdKey in internships/src/normalize.ts:
-- this file is that function rewritten in SQL, and the two produce identical
-- strings for every URL. Without this pass the database would hold two
-- generations of key, and the first cross-source copy of an already-sent job
-- would miss alert_delivery_subscriber_dedupe_idx and be sent a second time.
--
-- Listings whose URL carries no requisition id are left alone: the new code
-- falls through to the same canonical URL they already hold.
CREATE TEMP TABLE "listing_job_key" AS
WITH ws AS (
  -- Exactly the characters JavaScript's String.trim() removes: the TypeScript
  -- side trims before parsing, so the two must agree on what the input is.
  SELECT '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AS c
), parts AS (
  SELECT l."id",
    regexp_replace(
      lower(substring(t.v FROM '^[hH][tT][tT][pP][sS]?://(?:[^/?#@]*@)?([^/?#:]*)')),
      '^www\.', '') AS host,
    coalesce(substring(t.v FROM '^[hH][tT][tT][pP][sS]?://[^/?#]*(/[^?#]*)'), '') AS path,
    -- Led with '&' so the first param matches the same '&name=' pattern as the rest.
    '&' || coalesce(substring(t.v FROM '^[hH][tT][tT][pP][sS]?://[^?#]*\?([^#]*)'), '') AS query
  FROM "job_listing" l
  CROSS JOIN ws
  CROSS JOIN LATERAL (
    SELECT regexp_replace(l."url", '^' || ws.c || '+|' || ws.c || '+$', '', 'g') AS v
  ) t
), fields AS (
  SELECT "id", host, path, query,
    substring(query FROM '&gh_jid=([^&]*)') AS gh_jid,
    substring(query FROM '&ashby_jid=([^&]*)') AS ashby_jid,
    substring(query FROM '&token=([^&]*)') AS token,
    substring(query FROM '&pid=([^&]*)') AS pid,
    substring(query FROM '&job=([^&]*)') AS taleo_job,
    substring(path FROM '/jobs/(\d+)(?:/|$)') AS jobs_path_id,
    substring(path FROM '/job/(\d+)(?:/|$)') AS job_path_id,
    substring(path FROM '^/*[^/]+/+([^/]+)') AS second_segment,
    substring(path FROM '/(\d{9,})(?:/|$)') AS long_num_seg,
    substring(path FROM '/j/([0-9A-Za-z]+)(?:/|$)') AS workable_id,
    substring(path FROM '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') AS any_uuid,
    substring(path FROM '/job/([0-9A-Za-z_-]+)(?:/|$)') AS jobvite_id,
    substring(lower(path) FROM '/details/(\d+)') AS paylocity_id,
    substring(path FROM '/(\d{15,})(?:/|$)') AS bytedance_id,
    substring(path FROM '/(?:position|apply)/(\d{6,})(?:/|$)') AS janestreet_id,
    substring(path FROM '^/(?:careers-home/)?jobs/(\d+)(?:/|$)') AS vanity_id,
    -- A repost keeps the requisition number and gains a '-1'; three leading
    -- digits are required so a requisition genuinely named '…-1' survives.
    regexp_replace(coalesce(substring(path FROM '_([^_/]*)/*$'), ''), '(\d{3,})-\d$', '\1') AS wd_token,
    CASE
      WHEN host LIKE '%.myworkdayjobs.com' THEN split_part(host, '.', 1)
      WHEN host LIKE '%.myworkdaysite.com' THEN substring(path FROM '(?:^|/)recruiting/+([^/]+)')
    END AS wd_tenant
  FROM parts
), keyed AS (
  SELECT "id",
    CASE
      WHEN gh_jid ~ '^\d+$' THEN 'greenhouse:' || gh_jid
      WHEN ashby_jid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'ashby:' || lower(ashby_jid)
      WHEN (host = 'greenhouse.io' OR host LIKE '%.greenhouse.io') AND jobs_path_id IS NOT NULL THEN 'greenhouse:' || jobs_path_id
      WHEN (host = 'greenhouse.io' OR host LIKE '%.greenhouse.io') AND token ~ '^\d+$' THEN 'greenhouse:' || token
      WHEN host = 'jobs.ashbyhq.com' AND second_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'ashby:' || lower(second_segment)
      WHEN host IN ('jobs.lever.co', 'jobs.eu.lever.co') AND second_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'lever:' || lower(second_segment)
      WHEN wd_tenant IS NOT NULL AND wd_token ~ '\d' THEN 'workday:' || lower(wd_tenant) || ':' || lower(wd_token)
      WHEN host IN ('jobs.smartrecruiters.com', 'careers.smartrecruiters.com') AND long_num_seg IS NOT NULL THEN 'smartrecruiters:' || long_num_seg
      WHEN host LIKE '%.icims.com' AND jobs_path_id IS NOT NULL THEN 'icims:' || split_part(host, '.', 1) || ':' || jobs_path_id
      WHEN host LIKE '%.oraclecloud.com' AND job_path_id IS NOT NULL THEN 'oracle:' || split_part(host, '.', 1) || ':' || job_path_id
      WHEN host = 'apply.workable.com' AND workable_id IS NOT NULL THEN 'workable:' || upper(workable_id)
      WHEN host = 'ats.rippling.com' AND any_uuid IS NOT NULL THEN 'rippling:' || lower(any_uuid)
      WHEN (host LIKE '%.eightfold.ai' OR host = 'explore.jobs.netflix.net') AND coalesce(pid, job_path_id) ~ '^\d+$' THEN 'eightfold:' || split_part(host, '.', 1) || ':' || coalesce(pid, job_path_id)
      WHEN host LIKE '%.taleo.net' AND taleo_job <> '' THEN 'taleo:' || split_part(host, '.', 1) || ':' || taleo_job
      WHEN host LIKE '%.jobvite.com' AND jobvite_id IS NOT NULL THEN 'jobvite:' || split_part(host, '.', 1) || ':' || jobvite_id
      WHEN host LIKE '%.paylocity.com' AND paylocity_id IS NOT NULL THEN 'paylocity:' || paylocity_id
      WHEN host LIKE '%.bamboohr.com' AND substring(path FROM '/(\d+)(?:/|$)') IS NOT NULL THEN 'bamboohr:' || split_part(host, '.', 1) || ':' || substring(path FROM '/(\d+)(?:/|$)')
      WHEN host IN ('lifeattiktok.com', 'jobs.bytedance.com', 'joinbytedance.com', 'careers.tiktok.com') AND bytedance_id IS NOT NULL THEN 'bytedance:' || bytedance_id
      WHEN host = 'janestreet.com' AND janestreet_id IS NOT NULL THEN 'greenhouse:' || janestreet_id
      WHEN vanity_id IS NOT NULL THEN 'hostjob:' || host || ':' || vanity_id
    END AS "key"
  FROM fields
)
SELECT "id", "key" FROM keyed WHERE "key" IS NOT NULL;
--> statement-breakpoint
UPDATE "job_listing" l
SET "dedupe_key" = k."key"
FROM "listing_job_key" k
WHERE l."id" = k."id" AND l."dedupe_key" <> k."key";
--> statement-breakpoint
-- Two deliveries of one subscriber can collapse onto a single new key, which
-- alert_delivery_subscriber_dedupe_idx forbids — so the losers go before the
-- rewrite, not after. A row already marked 'sent' wins, so a job that has been
-- delivered stays delivered and its undelivered twin is dropped rather than
-- posted. Failing that, the row that can still be retried wins, then the oldest.
DELETE FROM "alert_delivery" d
USING (
  SELECT d."id",
    row_number() OVER (
      PARTITION BY d."subscriber_id", k."key"
      ORDER BY d."status" = 'sent' DESC, d."attempts" < 3 DESC, d."created_at", d."id"
    ) AS "rank"
  FROM "alert_delivery" d
  JOIN "listing_job_key" k ON k."id" = d."listing_id"
) ranked
WHERE d."id" = ranked."id" AND ranked."rank" > 1;
--> statement-breakpoint
UPDATE "alert_delivery" d
SET "dedupe_key" = k."key"
FROM "listing_job_key" k
WHERE d."listing_id" = k."id" AND d."dedupe_key" <> k."key";
--> statement-breakpoint
DROP TABLE "listing_job_key";
