// Adapters for the hosted ATS platforms. Each one has a public JSON board API,
// so none of these need HTML parsing — and because every posting carries a
// stable id, new-posting detection is an id diff rather than a content diff
// (which would fire false alerts every time a page's markup changed).

import { getJson } from "../http.ts";
import { termFromTitle } from "../normalize.ts";
import {
  optionalString,
  optionalStringList,
  requireString,
  type Adapter,
  type FetchResult,
  type RawListing,
} from "../types.ts";

function compact(values: (string | null | undefined)[]): string[] | null {
  const out = values.filter((v): v is string => !!v && !!v.trim());
  return out.length ? out : null;
}

// --------------------------------------------------------------------------
// Greenhouse — config: { board: "databricks" }
// Note some companies run a second board just for internships; add it as its
// own source rather than trying to express both in one config.
// --------------------------------------------------------------------------
interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
}

export const greenhouse: Adapter = async (config) => {
  const board = requireString(config, "board");
  const data = await getJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`,
  );
  const company = optionalString(config, "company") ?? board;

  const listings: RawListing[] = [];
  for (const j of data.jobs ?? []) {
    if (j.id === undefined || !j.title || !j.absolute_url) continue;
    listings.push({
      externalId: String(j.id),
      company,
      title: j.title,
      url: j.absolute_url,
      locations: compact([j.location?.name]),
      term: termFromTitle(j.title),
      sponsorship: null,
      category: null,
      postedAt: j.first_published ? new Date(j.first_published) : null,
    });
  }
  return { listings };
};

// --------------------------------------------------------------------------
// Lever — config: { company: "ramp" }
// --------------------------------------------------------------------------
interface LeverPost {
  id?: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: { location?: string; team?: string; commitment?: string };
}

export const lever: Adapter = async (config) => {
  const slug = requireString(config, "company");
  const posts = await getJson<LeverPost[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
  );
  const company = optionalString(config, "label") ?? slug;

  const listings: RawListing[] = [];
  for (const p of posts) {
    if (!p.id || !p.text || !p.hostedUrl) continue;
    listings.push({
      externalId: p.id,
      company,
      title: p.text,
      url: p.hostedUrl,
      locations: compact([p.categories?.location]),
      term: termFromTitle(p.text),
      sponsorship: null,
      category: p.categories?.team ?? null,
      postedAt: p.createdAt ? new Date(p.createdAt) : null,
    });
  }
  return { listings };
};

// --------------------------------------------------------------------------
// Ashby — config: { board: "linear" }
// Ashby is the one platform that states employment type outright, so an
// "Intern" posting is identifiable without reading the title.
// --------------------------------------------------------------------------
interface AshbyJob {
  id?: string;
  title?: string;
  jobUrl?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  publishedAt?: string;
  employmentType?: string;
  isListed?: boolean;
}

export const ashby: Adapter = async (config) => {
  const board = requireString(config, "board");
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`,
  );
  const company = optionalString(config, "company") ?? board;

  const listings: RawListing[] = [];
  for (const j of data.jobs ?? []) {
    if (!j.id || !j.title || !j.jobUrl) continue;
    if (j.isListed === false) continue;
    // Surfaced in the title so the shared intern/co-op filter can act on it —
    // Ashby titles frequently omit the word even for internship postings.
    const title =
      j.employmentType === "Intern" && !/\bintern/i.test(j.title)
        ? `${j.title} (Intern)`
        : j.title;
    listings.push({
      externalId: j.id,
      company,
      title,
      url: j.jobUrl,
      locations: compact([
        j.location,
        ...(j.secondaryLocations ?? []).map((l) => l.location),
      ]),
      term: termFromTitle(j.title),
      sponsorship: null,
      category: null,
      postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
    });
  }
  return { listings };
};

// --------------------------------------------------------------------------
// Workday — config: { host, tenant, site, searchText? }
// e.g. { host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia",
//        site: "NVIDIAExternalCareerSite" }
// Paginated at 20 per page, so `searchText` (default "intern") does the heavy
// narrowing server-side — Nvidia alone has 900+ open roles.
// --------------------------------------------------------------------------
interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  bulletFields?: string[];
}

const WORKDAY_PAGE = 20;
const WORKDAY_MAX_PAGES = 10;

export const workday: Adapter = async (config) => {
  const host = requireString(config, "host");
  const tenant = requireString(config, "tenant");
  const site = requireString(config, "site");
  const searchText = optionalString(config, "searchText") ?? "intern";
  const company = optionalString(config, "company") ?? tenant;
  const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < WORKDAY_MAX_PAGES; page++) {
    const data = await getJson<{
      total?: number;
      jobPostings?: WorkdayPosting[];
    }>(endpoint, {
      method: "POST",
      body: {
        appliedFacets: {},
        limit: WORKDAY_PAGE,
        offset: page * WORKDAY_PAGE,
        searchText,
      },
    });

    const batch = data.jobPostings ?? [];
    for (const p of batch) {
      if (!p.title || !p.externalPath) continue;
      // The requisition id in bulletFields is stabler than the URL slug, which
      // changes if the posting is retitled.
      const externalId = p.bulletFields?.[0] ?? p.externalPath;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      listings.push({
        externalId,
        company,
        title: p.title,
        url: `https://${host}/en-US/${site}${p.externalPath}`,
        locations: compact([p.locationsText]),
        term: termFromTitle(p.title),
        sponsorship: null,
        category: null,
        // Workday only exposes "Posted 30+ Days Ago" — useless as a date, and
        // unnecessary since firstSeenAt is what drives alerting.
        postedAt: null,
      });
    }

    if (batch.length < WORKDAY_PAGE) break;
    if ((page + 1) * WORKDAY_PAGE >= (data.total ?? 0)) break;
  }
  return { listings };
};

// --------------------------------------------------------------------------
// Eightfold — config: { host, domain, api?, query?, filters?, internTitlePatterns? }
// e.g. { host: "explore.jobs.netflix.net", domain: "netflix.com" }
//
// Eightfold powers a company's own careers subdomain, so this reads the same API
// the company's page calls rather than a third-party board. Netflix's careers
// page is otherwise unscrapeable: it renders five anchors and no postings.
//
// Tenants on Eightfold's newer PCSX careers site (Lockheed Martin) answer the
// v2 endpoint with 403 "Not authorized for PCSX", so `api: "pcsx"` selects the
// search endpoint that site calls. `filters` maps a PCSX facet to the values to
// select, sent as `filter_<facet>=<value>`; `query: ""` searches without a
// keyword, which lets a facet do the narrowing instead.
//
// `internTitlePatterns` are case-insensitive regexes for titles this employer
// uses for internships without saying so. Like Ashby's employment type, a match
// is surfaced as "(Intern)" in the title so the shared filter acts on it.
// --------------------------------------------------------------------------
interface EightfoldPosition {
  id?: number | string;
  ats_job_id?: string;
  name?: string;
  canonicalPositionUrl?: string;
  locations?: string[];
  location?: string;
  department?: string;
  t_update?: number;
}

interface PcsxPosition {
  id?: number;
  atsJobId?: string;
  name?: string;
  locations?: string[];
  standardizedLocations?: string[];
  department?: string;
  postedTs?: number;
  positionUrl?: string;
}

const EIGHTFOLD_PAGE = 50;
const EIGHTFOLD_MAX_PAGES = 10;
// PCSX ignores page-size parameters and always returns 10.
const PCSX_PAGE = 10;
const PCSX_MAX_PAGES = 30;

function internTitle(title: string, patterns: RegExp[]): string {
  return patterns.some((p) => p.test(title)) && !/\bintern/i.test(title)
    ? `${title} (Intern)`
    : title;
}

function pcsxFilters(config: Record<string, unknown>): string {
  const filters = config.filters;
  if (filters === undefined) return "";
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    throw new Error("config.filters must be an object of facet -> value(s)");
  }
  let qs = "";
  for (const [facet, raw] of Object.entries(filters)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`config.filters.${facet} must be a string or string array`);
      }
      qs += `&filter_${encodeURIComponent(facet)}=${encodeURIComponent(value.trim())}`;
    }
  }
  return qs;
}

export const eightfold: Adapter = async (config) => {
  const host = requireString(config, "host");
  const domain = requireString(config, "domain");
  const api = optionalString(config, "api") ?? "v2";
  const query = typeof config.query === "string" ? config.query.trim() : "intern";
  const company = optionalString(config, "company") ?? domain.split(".")[0]!;
  const patterns = optionalStringList(config, "internTitlePatterns").map(
    (p) => new RegExp(p, "i"),
  );

  if (api === "pcsx") return eightfoldPcsx(config, host, domain, query, company, patterns);
  if (api !== "v2") throw new Error(`config.api must be "v2" or "pcsx", got "${api}"`);

  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < EIGHTFOLD_MAX_PAGES; page++) {
    const data = await getJson<{
      count?: number;
      positions?: EightfoldPosition[];
    }>(
      `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}` +
        `&query=${encodeURIComponent(query)}&num=${EIGHTFOLD_PAGE}&start=${page * EIGHTFOLD_PAGE}`,
    );

    const batch = data.positions ?? [];
    for (const p of batch) {
      const externalId = p.ats_job_id ?? (p.id !== undefined ? String(p.id) : null);
      if (!externalId || !p.name || !p.canonicalPositionUrl) continue;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      listings.push({
        externalId,
        company,
        title: internTitle(p.name, patterns),
        url: p.canonicalPositionUrl,
        // Eightfold joins location parts with commas and no spaces:
        // "Los Gatos,California,United States of America".
        locations: compact(
          (p.locations?.length ? p.locations : [p.location]).map((l) =>
            l ? l.split(",").map((s) => s.trim()).filter(Boolean).join(", ") : null,
          ),
        ),
        term: termFromTitle(p.name),
        sponsorship: null,
        category: p.department ?? null,
        postedAt: p.t_update ? new Date(p.t_update * 1000) : null,
      });
    }

    if (batch.length < EIGHTFOLD_PAGE) break;
    if ((page + 1) * EIGHTFOLD_PAGE >= (data.count ?? 0)) break;
  }
  return { listings };
};

async function eightfoldPcsx(
  config: Record<string, unknown>,
  host: string,
  domain: string,
  query: string,
  company: string,
  patterns: RegExp[],
): Promise<FetchResult> {
  const filters = pcsxFilters(config);
  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < PCSX_MAX_PAGES; page++) {
    const data = await getJson<{
      data?: { count?: number; positions?: PcsxPosition[] };
    }>(
      `https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}` +
        `&query=${encodeURIComponent(query)}&location=${filters}&start=${page * PCSX_PAGE}`,
    );

    const batch = data.data?.positions ?? [];
    for (const p of batch) {
      const externalId = p.atsJobId ?? (p.id !== undefined ? String(p.id) : null);
      if (!externalId || !p.name || !p.positionUrl) continue;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      listings.push({
        externalId,
        company,
        title: internTitle(p.name, patterns),
        url: new URL(p.positionUrl, `https://${host}`).toString(),
        // The display form abbreviates countries to ISO-3 ("Ottawa, CAN",
        // "Havant, GBR"), which the location filter can't place; the
        // standardized form spells out province and country ("Ottawa, ON, CA").
        locations: compact(
          p.standardizedLocations?.length ? p.standardizedLocations : (p.locations ?? []),
        ),
        term: termFromTitle(p.name),
        sponsorship: null,
        category: p.department ?? null,
        postedAt: p.postedTs ? new Date(p.postedTs * 1000) : null,
      });
    }

    if (batch.length < PCSX_PAGE) break;
    if ((page + 1) * PCSX_PAGE >= (data.data?.count ?? 0)) break;
  }
  return { listings };
}

// --------------------------------------------------------------------------
// SmartRecruiters — config: { company: "Visa" }
// --------------------------------------------------------------------------
interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
}

const SR_PAGE = 100;
const SR_MAX_PAGES = 10;

export const smartrecruiters: Adapter = async (config) => {
  const slug = requireString(config, "company");
  const company = optionalString(config, "label") ?? slug;
  const listings: RawListing[] = [];

  for (let page = 0; page < SR_MAX_PAGES; page++) {
    const data = await getJson<{
      totalFound?: number;
      content?: SmartRecruitersPosting[];
    }>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${SR_PAGE}&offset=${page * SR_PAGE}`,
    );
    const batch = data.content ?? [];
    for (const p of batch) {
      if (!p.id || !p.name) continue;
      listings.push({
        externalId: p.id,
        company,
        title: p.name,
        url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
        locations: compact([
          [p.location?.city, p.location?.region].filter(Boolean).join(", ") ||
            p.location?.country,
        ]),
        term: termFromTitle(p.name),
        sponsorship: null,
        category: null,
        postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
      });
    }
    if (batch.length < SR_PAGE) break;
    if ((page + 1) * SR_PAGE >= (data.totalFound ?? 0)) break;
  }
  return { listings };
};

// --------------------------------------------------------------------------
// Phenom — config: { host, lang, country, company, keywords?, pathPrefix? }
// e.g. { host: "jobs.baesystems.com", lang: "en_global", country: "global" }
//
// Phenom career sites search through a `refineSearch` widget call; `lang` and
// `country` are the site's locale, read off phApp.ddo on its search page. Job
// pages live at /{country}/{language}/job/{jobId}, so the prefix is derived
// from `lang` ("en_us" -> "us/en") unless `pathPrefix` overrides it.
// --------------------------------------------------------------------------
interface PhenomJob {
  jobId?: string;
  title?: string;
  multi_location?: string[];
  location?: string;
  postedDate?: string;
}

const PHENOM_PAGE = 100;
const PHENOM_MAX_PAGES = 10;

export const phenom: Adapter = async (config) => {
  const host = requireString(config, "host");
  const lang = requireString(config, "lang");
  const country = requireString(config, "country");
  const company = requireString(config, "company");
  const keywords = optionalString(config, "keywords") ?? "intern";
  const [language, region] = lang.split("_");
  const pathPrefix = (
    optionalString(config, "pathPrefix") ?? `${region}/${language}`
  ).replace(/^\/+|\/+$/g, "");

  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < PHENOM_MAX_PAGES; page++) {
    const data = await getJson<{
      refineSearch?: { totalHits?: number; data?: { jobs?: PhenomJob[] } };
    }>(`https://${host}/widgets`, {
      method: "POST",
      body: {
        ddoKey: "refineSearch",
        lang,
        country,
        keywords,
        size: PHENOM_PAGE,
        from: page * PHENOM_PAGE,
        // Without `jobs: true` the widget returns counts and no postings.
        jobs: true,
        siteType: "external",
        pageName: "search-results",
        global: true,
      },
    });

    const batch = data.refineSearch?.data?.jobs ?? [];
    for (const j of batch) {
      if (!j.jobId || !j.title) continue;
      if (seen.has(j.jobId)) continue;
      seen.add(j.jobId);
      listings.push({
        externalId: j.jobId,
        company,
        title: j.title,
        url: `https://${host}/${pathPrefix}/job/${encodeURIComponent(j.jobId)}`,
        // multi_location repeats sites for postings spread across them.
        locations: compact([
          ...new Set(j.multi_location?.length ? j.multi_location : [j.location]),
        ]),
        term: termFromTitle(j.title),
        sponsorship: null,
        category: null,
        postedAt: j.postedDate ? new Date(j.postedDate) : null,
      });
    }

    if (batch.length < PHENOM_PAGE) break;
    if ((page + 1) * PHENOM_PAGE >= (data.refineSearch?.totalHits ?? 0)) break;
  }
  return { listings };
};

// --------------------------------------------------------------------------
// DirectEmployers (dejobs.org) — config: { origin, company, query? }
// e.g. { origin: "saic.dejobs.org", company: "SAIC" }
//
// A .jobs microsite is a nightly mirror of the employer's ATS, searched through
// the jobsyn API with the site named in `x-origin`. The mirror lists a
// requisition once per location, so rows are grouped on `reqid` and their
// locations merged; the lowest guid supplies the link so it is stable between
// polls.
// --------------------------------------------------------------------------
interface DejobsJob {
  guid?: string;
  reqid?: string;
  title_exact?: string;
  title_slug?: string;
  location_exact?: string;
  date_new?: string;
}

const DEJOBS_MAX_PAGES = 20;

// The microsite's own slug rule: strip diacritics, quotes, "+", ":" and "/",
// then join the remaining word runs with hyphens.
function dejobsSlug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/"|\p{Diacritic}/gu, "")
      .replace(/["’+:/]/g, "")
      .match(/\w+/g)
      ?.join("-")
      .toLowerCase() ?? ""
  );
}

export const dejobs: Adapter = async (config) => {
  const origin = requireString(config, "origin");
  const company = requireString(config, "company");
  const query = optionalString(config, "query") ?? "intern";

  const groups = new Map<string, DejobsJob[]>();
  for (let page = 1; page <= DEJOBS_MAX_PAGES; page++) {
    const data = await getJson<{
      jobs?: DejobsJob[];
      pagination?: { has_more_pages?: boolean };
    }>(
      `https://prod-search-api.jobsyn.org/api/v1/solr/search?q=${encodeURIComponent(query)}&page=${page}`,
      { headers: { "x-origin": origin } },
    );
    for (const j of data.jobs ?? []) {
      if (!j.guid || !j.reqid || !j.title_exact || !j.title_slug || !j.location_exact) {
        continue;
      }
      groups.set(j.reqid, [...(groups.get(j.reqid) ?? []), j]);
    }
    if (!data.pagination?.has_more_pages) break;
  }

  const listings: RawListing[] = [];
  for (const [externalId, rows] of groups) {
    const first = rows.reduce((a, b) => (b.guid! < a.guid! ? b : a));
    const title = first.title_exact!;
    const dates = rows.map((r) => r.date_new).filter((d): d is string => !!d).sort();
    listings.push({
      externalId,
      company,
      title,
      url: `https://${origin}/${dejobsSlug(first.location_exact!)}/${first.title_slug}/${first.guid}/job/`,
      locations: compact([...new Set(rows.map((r) => r.location_exact))]),
      term: termFromTitle(title),
      sponsorship: null,
      category: null,
      postedAt: dates[0] ? new Date(dates[0]) : null,
    });
  }
  return { listings };
};
