-- application.dedupe_key gains a term segment, so the same role reopened for a
-- later cycle is a distinct entry instead of colliding with the earlier one on
-- application_user_dedupe_idx. See dedupeKeyFor in src/lib/applications.ts.
--
-- No index change: the three-part key is a strict refinement of the two-part one,
-- so rows that were already unique on (user_id, company::position) stay unique.
UPDATE "application"
SET "dedupe_key" =
  lower("company") || '::' || lower("position") || '::' || lower(coalesce("term", ''));
