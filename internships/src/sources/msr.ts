// Microsoft Research's own opportunities board.
//
// MSR does not post its research internships to jobs.careers.microsoft.com — the
// page the "Microsoft" scraped source reads — so every "Research Intern for
// <group>" role was invisible to the poller. The board is a WordPress site with
// a public, versioned REST API, which is why this is a JSON adapter rather than
// another Playwright scrape: it hands back the cities and the opportunity type
// per posting, and the location filter is blind without them. The public
// open-positions page is server-rendered but paginated ten at a time, so
// scraping it would be twelve page loads for the same data.
//
// config: { company?: "Microsoft Research" }

import { createHash } from "node:crypto";
import { getJson } from "../http.ts";
import { termFromTitle } from "../normalize.ts";
import { optionalString, type Adapter, type RawListing } from "../types.ts";

const API =
  "https://www.microsoft.com/en-us/research/wp-json/microsoft-research/v2/careers";

// The board's own taxonomy. Narrowing here rather than fetching all ~95 open
// roles is what keeps `view=full` affordable, and it costs nothing: the app's
// filters still run on every row that comes back, so a full-time role mistagged
// as an internship is caught by INTERN_TOKEN / DISQUALIFYING downstream.
const TYPE = "internship";
const PER_PAGE = 100;
// ~30 internships are open at a time. Ten pages is 1,000 — far past anything
// real, so reaching it means the pagination contract changed rather than that
// MSR is hiring.
const MAX_PAGES = 10;

interface Envelope<T> {
  items?: T[];
  _pagination?: { total?: number; currentPage?: number; totalPages?: number };
}

interface CompactRow {
  id?: number;
  dateModified?: string | null;
}

interface Term {
  name?: string | null;
  slug?: string | null;
}

interface FullRow {
  id?: number;
  name?: string;
  url?: string;
  slug?: string;
  datePosted?: string | null;
  datePublished?: string | null;
  cities?: Term[] | null;
  researchAreas?: Term[] | null;
}

function endpoint(view: "compact" | "full", page: number): string {
  return `${API}?type=${TYPE}&view=${view}&per_page=${PER_PAGE}&page=${page}`;
}

async function fetchPages<T>(view: "compact" | "full"): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body = await getJson<Envelope<T>>(endpoint(view, page));
    if (!Array.isArray(body.items)) {
      // An envelope without `items` is a changed API, which is worth failing on.
      // A *present but empty* items array is not — it is the honest answer when
      // no internships are open, and throwing there would deactivate every
      // listing this source has.
      throw new Error(
        `MSR careers API returned no "items" array (${view} view, page ${page}) — the API shape probably changed`,
      );
    }
    rows.push(...body.items);
    totalPages = body._pagination?.totalPages ?? 1;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);

  if (totalPages > MAX_PAGES) {
    throw new Error(
      `MSR careers API reported ${totalPages} pages of internships — past the ${MAX_PAGES}-page cap, so this is not being read completely`,
    );
  }
  return rows;
}

export const msr: Adapter = async (config, ctx) => {
  const company = optionalString(config, "company") ?? "Microsoft Research";

  // The compact view is ~12KB against ~575KB for the full one, and it carries
  // the id and dateModified of every posting — enough to prove nothing moved.
  // Most polls therefore stop here rather than pulling the descriptions.
  const compact = await fetchPages<CompactRow>("compact");
  const sha = createHash("sha1")
    .update(
      compact
        .map((row) => `${row.id ?? ""}:${row.dateModified ?? ""}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  if (ctx.lastSha && ctx.lastSha === sha) {
    return { listings: [], sha, unchanged: true };
  }

  const rows = await fetchPages<FullRow>("full");
  const listings: RawListing[] = [];

  for (const row of rows) {
    const title = row.name?.trim();
    // `url` is the apply link, which for most postings is the Microsoft careers
    // ATS and for the rest is the MSR opportunity page itself. Either is where
    // you actually apply, so it is also the dedupe key's basis.
    const url = row.url?.trim();
    if (row.id === undefined || !title || !url) continue;

    const cities = (row.cities ?? [])
      .map((city) => city.name?.trim())
      .filter((name): name is string => Boolean(name));

    const posted = row.datePosted ?? row.datePublished ?? null;
    const postedAt = posted ? new Date(posted) : null;

    listings.push({
      externalId: String(row.id),
      company,
      title,
      url,
      // MSR states real cities ("Beijing, China", "Cambridge, MA, US"), so the
      // US/Canada rule has something to work with — most of this board is
      // Beijing, Shanghai and Bangalore, and without these it would all pass.
      locations: cities.length ? cities : null,
      term: termFromTitle(title),
      sponsorship: null,
      category: row.researchAreas?.[0]?.name?.trim() ?? null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    });
  }

  return { listings, sha };
};
