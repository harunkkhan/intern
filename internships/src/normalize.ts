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

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_SEGMENT = new RegExp(`^${UUID}$`, "i");
const UUID_ANYWHERE = new RegExp(UUID, "i");

/**
 * The requisition id an applicant tracking system puts in its apply URL. One job
 * is one requisition, so keying on it collapses copies that differ only in host,
 * path suffix or embed params: `boards.` vs `job-boards.greenhouse.io`, Lever's
 * `/apply`, Ashby's `/application?embed=true`, and Workday's per-site aliases
 * (`medtroniccareers` vs `redeploymentmedtroniccareers`) and `-1` copy suffixes.
 *
 * `drizzle/0012_job_id_dedupe_keys.sql` reproduces this in SQL to rekey the rows
 * written before it existed. The two must produce identical strings or the
 * database ends up holding two generations of key, so keep them in step.
 */
function jobIdKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const subdomain = host.split(".")[0] ?? "";
  const path = url.pathname;
  const second = path.split("/").filter(Boolean)[1] ?? "";
  const jobsPathId = path.match(/\/jobs\/(\d+)(?:\/|$)/)?.[1];
  const jobPathId = path.match(/\/job\/(\d+)(?:\/|$)/)?.[1];

  // Params first: a company careers page that embeds someone else's board names
  // the requisition in the query string, so it keys with the board's own copy.
  const ghParam = url.searchParams.get("gh_jid");
  if (ghParam && /^\d+$/.test(ghParam)) return `greenhouse:${ghParam}`;
  const ashbyParam = url.searchParams.get("ashby_jid");
  if (ashbyParam && UUID_SEGMENT.test(ashbyParam)) {
    return `ashby:${ashbyParam.toLowerCase()}`;
  }

  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const token = url.searchParams.get("token");
    if (jobsPathId) return `greenhouse:${jobsPathId}`;
    if (token && /^\d+$/.test(token)) return `greenhouse:${token}`;
  }
  if (host === "jobs.ashbyhq.com" && UUID_SEGMENT.test(second)) {
    return `ashby:${second.toLowerCase()}`;
  }
  if (
    (host === "jobs.lever.co" || host === "jobs.eu.lever.co") &&
    UUID_SEGMENT.test(second)
  ) {
    return `lever:${second.toLowerCase()}`;
  }
  // Workday's tenant is stable; the site name in the path is what differs
  // between two career sites publishing one requisition, so it stays out.
  const workdayTenant = host.endsWith(".myworkdayjobs.com")
    ? subdomain
    : host.endsWith(".myworkdaysite.com")
      ? path.match(/(?:^|\/)recruiting\/+([^/]+)/)?.[1]
      : undefined;
  if (workdayTenant) {
    // A repost keeps the requisition number and gains a `-1`. Guarded on three
    // leading digits so a requisition genuinely named `…-1` survives intact.
    const token = (path.match(/_([^_/]*)\/*$/)?.[1] ?? "").replace(
      /(\d{3,})-\d$/,
      "$1",
    );
    if (/\d/.test(token)) {
      return `workday:${workdayTenant.toLowerCase()}:${token.toLowerCase()}`;
    }
  }
  if (
    host === "jobs.smartrecruiters.com" ||
    host === "careers.smartrecruiters.com"
  ) {
    const id = path.match(/\/(\d{9,})(?:\/|$)/)?.[1];
    if (id) return `smartrecruiters:${id}`;
  }
  if (host.endsWith(".icims.com") && jobsPathId) {
    return `icims:${subdomain}:${jobsPathId}`;
  }
  if (host.endsWith(".oraclecloud.com") && jobPathId) {
    return `oracle:${subdomain}:${jobPathId}`;
  }
  if (host === "apply.workable.com") {
    const id = path.match(/\/j\/([0-9a-z]+)(?:\/|$)/i)?.[1];
    if (id) return `workable:${id.toUpperCase()}`;
  }
  if (host === "ats.rippling.com") {
    const id = path.match(UUID_ANYWHERE)?.[0];
    if (id) return `rippling:${id.toLowerCase()}`;
  }
  if (host.endsWith(".eightfold.ai") || host === "explore.jobs.netflix.net") {
    const id = url.searchParams.get("pid") ?? jobPathId;
    if (id && /^\d+$/.test(id)) return `eightfold:${subdomain}:${id}`;
  }
  if (host.endsWith(".taleo.net")) {
    const id = url.searchParams.get("job");
    if (id) return `taleo:${subdomain}:${id}`;
  }
  if (host.endsWith(".jobvite.com")) {
    const id = path.match(/\/job\/([0-9a-z_-]+)(?:\/|$)/i)?.[1];
    if (id) return `jobvite:${subdomain}:${id}`;
  }
  if (host.endsWith(".paylocity.com")) {
    const id = path.match(/\/details\/(\d+)/i)?.[1];
    if (id) return `paylocity:${id}`;
  }
  if (host.endsWith(".bamboohr.com")) {
    const id = path.match(/\/(\d+)(?:\/|$)/)?.[1];
    if (id) return `bamboohr:${subdomain}:${id}`;
  }
  // ByteDance publishes one requisition across its own careers hosts.
  if (
    host === "lifeattiktok.com" ||
    host === "jobs.bytedance.com" ||
    host === "joinbytedance.com" ||
    host === "careers.tiktok.com"
  ) {
    const id = path.match(/\/(\d{15,})(?:\/|$)/)?.[1];
    if (id) return `bytedance:${id}`;
  }
  // Jane Street links the same Greenhouse requisition two ways: `/apply/<id>`
  // carries `gh_jid` and is keyed above, `/position/<id>` carries nothing.
  if (host === "janestreet.com") {
    const id = path.match(/\/(?:position|apply)\/(\d{6,})(?:\/|$)/)?.[1];
    if (id) return `greenhouse:${id}`;
  }
  // A vanity careers domain numbering jobs at `/jobs/<id>`, which is an iCIMS
  // tenant behind its own hostname. The host stays in the key because the rule
  // can't prove which system is answering, only that the id is the company's.
  const vanityId = path.match(/^\/(?:careers-home\/)?jobs\/(\d+)(?:\/|$)/)?.[1];
  if (vanityId) return `hostjob:${host}:${vanityId}`;

  return null;
}

/**
 * Identifies the same posting across sources. Both GitHub feeds carry many of
 * the same jobs under different ids, and a company's own ATS board carries them
 * a third time — deliveries dedupe on this so one job is one message. The
 * requisition id is tried first because the three copies rarely share a URL;
 * the canonical URL still covers scraped pages that carry no id at all.
 */
export function dedupeKeyFor(
  company: string,
  title: string,
  url: string,
): string {
  return (
    jobIdKey(url) ??
    canonicalUrl(url) ??
    `${normalizeCompany(company)}::${normalizeTitle(title)}`
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
