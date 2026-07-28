// Cross-source dedupe keys and term parsing.

// Company normalization lives in the web app so the Alerts API and this poller
// cannot drift apart — a watchlist match is an equality check between the two.
export { normalizeCompany } from "../../src/lib/company.ts";
import { normalizeCompany } from "../../src/lib/company.ts";

const TITLE_FILLER =
  /\b(intern|interns|internship|internships|co|op|coop|program|programme|summer|fall|autumn|winter|spring|the|a|an|of|for|role|position|opening|req|id)\b/g;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b20\d\d\b/g, " ")
    .replace(TITLE_FILLER, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Query params that identify a posting vs. ones that only track where a click
// came from. Getting this wrong is destructive: Greenhouse puts the job id in
// `?gh_jid=`, so blanket-stripping the query string would collapse every job at
// a company onto one dedupe key and suppress all but the first alert.
const TRACKING_PARAM =
  /^(utm_\w+|gh_src|lever-source|source|src|ref|referrer|trk|trkref|mc_cid|mc_eid)$/i;

function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * Identifies the same posting across sources. Both GitHub feeds carry many of
 * the same jobs under different ids, and a company's own ATS board carries them
 * a third time — deliveries dedupe on this so one job is one message.
 */
export function dedupeKeyFor(
  company: string,
  title: string,
  url: string,
): string {
  return (
    canonicalUrl(url) ?? `${normalizeCompany(company)}::${normalizeTitle(title)}`
  );
}

const SEASONS = ["Spring", "Summer", "Fall", "Winter"] as const;

/**
 * Pulls a term like "Summer 2027" out of a job title. Handles "Fall 2026",
 * "Summer '27", and the reversed "2027 Summer".
 */
export function termFromTitle(title: string): string | null {
  const seasons = "spring|summer|fall|autumn|winter";
  const match =
    title.match(new RegExp(`\\b(${seasons})\\b[\\s,\\-–]*'?(\\d{4}|\\d{2})\\b`, "i")) ??
    title.match(new RegExp(`\\b(\\d{4})\\b[\\s,\\-–]*(${seasons})\\b`, "i"));
  if (!match) return null;

  // The two patterns capture season/year in opposite orders.
  const a = match[1];
  const b = match[2];
  if (!a || !b) return null;
  const rawSeason = /^\d/.test(a) ? b : a;
  const rawYear = /^\d/.test(a) ? a : b;

  const season = SEASONS.find(
    (s) =>
      s.toLowerCase() === rawSeason.toLowerCase() ||
      (rawSeason.toLowerCase() === "autumn" && s === "Fall"),
  );
  if (!season) return null;

  const year =
    rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (!Number.isFinite(year) || year < 2020 || year > 2040) return null;

  return `${season} ${year}`;
}

/**
 * Normalizes a source-supplied term string onto the app's TERMS vocabulary.
 * Returns null for placeholders like "N/A" so the listing is treated as
 * unknown-term (which passes the filter) rather than as a term we then fail to
 * match.
 */
export function cleanTerm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || /^(n\/?a|unknown|tbd|any)$/i.test(value)) return null;
  const parsed = termFromTitle(value);
  if (parsed) return parsed;
  return value;
}
