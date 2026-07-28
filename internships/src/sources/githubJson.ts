// The community internship-listing repos (SimplifyJobs, vanshb03). Both publish
// a JSON array with stable uuids, so there is no HTML to parse — this is a fetch
// and an id diff.
//
// config: { repo: "owner/name", path: ".github/scripts/listings.json" }

import { getJson } from "../http.ts";
import { cleanTerm, termFromTitle } from "../normalize.ts";
import { requireString, type Adapter, type RawListing } from "../types.ts";

interface Record_ {
  id?: string;
  company_name?: string;
  title?: string;
  url?: string;
  locations?: string[];
  active?: boolean;
  is_visible?: boolean;
  date_posted?: number;
  terms?: string[];
  season?: string;
  sponsorship?: string;
  category?: string;
}

interface CommitEntry {
  sha?: string;
}

export const githubJson: Adapter = async (config, ctx) => {
  const repo = requireString(config, "repo");
  const path = requireString(config, "path");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  // Raises the API ceiling from 60/hr to 5,000/hr. GitHub Actions injects this
  // automatically; at a 10-minute cadence the unauthenticated limit would be
  // fine, but a re-run storm would not be.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  // Cheap change check first. The SimplifyJobs file is ~11 MB; downloading it
  // every 10 minutes would be ~47 GB/month for a file that changes a few times
  // a day.
  const commits = await getJson<CommitEntry[]>(
    `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`,
    { headers },
  );
  const sha = commits[0]?.sha;
  if (!sha) throw new Error(`no commits found for ${repo}:${path}`);
  if (ctx.lastSha === sha) return { listings: [], sha, unchanged: true };

  // Pinned to the sha rather than a branch so the content matches the revision
  // we are about to record.
  const records = await getJson<Record_[]>(
    `https://raw.githubusercontent.com/${repo}/${sha}/${path}`,
  );

  const listings: RawListing[] = [];
  for (const r of records) {
    if (!r.id || !r.company_name || !r.title || !r.url) continue;
    // Both feeds keep closed roles around with these flags cleared.
    if (r.active === false || r.is_visible === false) continue;

    listings.push({
      externalId: r.id,
      company: r.company_name,
      title: r.title,
      url: r.url,
      locations: r.locations?.length ? r.locations : null,
      term: resolveTerm(r),
      sponsorship: r.sponsorship ?? null,
      category: r.category ?? null,
      postedAt: r.date_posted ? new Date(r.date_posted * 1000) : null,
    });
  }
  return { listings, sha };
};

// SimplifyJobs carries `terms: ["Fall 2026"]`, which maps straight onto the
// app's vocabulary. vanshb03 carries `season: "Summer"` with no year at all, and
// its date_posted spans two recruiting cycles — guessing a year from the posting
// date is unreliable, so an unyearned season is left as unknown. Unknown terms
// pass the filter, so nothing is lost by declining to guess.
function resolveTerm(r: Record_): string | null {
  for (const raw of r.terms ?? []) {
    const term = cleanTerm(raw);
    if (term) return term;
  }
  return termFromTitle(r.title ?? "");
}
