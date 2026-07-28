// Canonical company-name normalization.
//
// Shared deliberately: the Alerts API writes `watched_company.normalized_name`
// and the poller writes `job_listing.normalized_company`, and a watchlist match
// is an equality check between the two. If the two sides ever normalized
// differently, watchlist alerts would silently stop firing — so both import this
// file rather than keeping their own copy. Kept dependency-free so the Bun
// poller can import it directly across the folder boundary.

// Suffixes and filler that differ between sources for the same employer:
// SimplifyJobs says "Databricks", an ATS board says "Databricks, Inc.".
// "and" is here because `&` expands to it below: without stripping it,
// "D. E. Shaw & Co." and "D.E. Shaw" normalize differently and never match.
const COMPANY_FILLER =
  /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|holding|technologies|technology|labs|laboratories|solutions|systems|the|and|a)\b/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_FILLER, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
