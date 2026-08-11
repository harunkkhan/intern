// Adapter registry. `job_source.adapter` holds one of these keys.

import type { Adapter } from "../types.ts";
import { githubJson } from "./githubJson.ts";
import { githubMarkdown } from "./githubMarkdown.ts";
import { html } from "./html.ts";
import { msr } from "./msr.ts";
import { scraped } from "./scraped.ts";
import {
  ashby,
  eightfold,
  greenhouse,
  lever,
  smartrecruiters,
  workday,
} from "./ats.ts";

export const ADAPTERS = {
  github: githubJson,
  githubMarkdown,
  greenhouse,
  lever,
  ashby,
  workday,
  smartrecruiters,
  eightfold,
  // Playwright + BeautifulSoup, for companies whose postings live only on their
  // own site. See internships/src/sources/scraped.ts.
  scraped,
  html,
  // Microsoft Research's WordPress board, which the main Microsoft careers site
  // does not carry. See internships/src/sources/msr.ts.
  msr,
} satisfies Record<string, Adapter>;

export type AdapterName = keyof typeof ADAPTERS;

export function resolveAdapter(name: string): Adapter {
  const adapter = (ADAPTERS as Record<string, Adapter | undefined>)[name];
  if (!adapter) {
    throw new Error(
      `unknown adapter "${name}" — expected one of ${Object.keys(ADAPTERS).join(", ")}`,
    );
  }
  return adapter;
}

// Sources every install wants, upserted on each run so a fresh database needs no
// manual SQL. Both are internship-only repos, hence trustedInternOnly. They poll
// at the workflow's full cadence: a commit-sha check is one cheap request, and
// the download only happens when the feed actually changed.
export const BUILTIN_SOURCES = [
  {
    label: "SimplifyJobs",
    adapter: "github",
    config: {
      repo: "SimplifyJobs/Summer2026-Internships",
      path: ".github/scripts/listings.json",
    },
    trustedInternOnly: true,
    pollIntervalMinutes: 10,
    listKey: "general-github",
  },
  {
    label: "vanshb03",
    adapter: "github",
    config: {
      repo: "vanshb03/Summer2027-Internships",
      path: ".github/scripts/listings.json",
    },
    trustedInternOnly: true,
    pollIntervalMinutes: 10,
    listKey: "general-github",
  },
  {
    // Publishes the same listings.json shape as the general feeds, with extra
    // opportunity_type / target_year fields we don't need.
    label: "underclassmen-opportunities",
    adapter: "github",
    config: {
      repo: "Jose-Gael-Cruz-Lopez/underclassmen-opportunities",
      path: ".github/scripts/listings.json",
    },
    trustedInternOnly: true,
    pollIntervalMinutes: 10,
    listKey: "underclassmen-github",
  },
  {
    // README tables only — no JSON — and its rows are programs rather than
    // individual reqs, so a new row means a newly-tracked program.
    label: "underclassmen-internships",
    adapter: "githubMarkdown",
    config: {
      repo: "zapplyjobs/underclassmen-internships",
      path: "README.md",
    },
    trustedInternOnly: true,
    pollIntervalMinutes: 10,
    listKey: "underclassmen-github",
  },
  {
    // NSF's REU directory. Rendered rather than fetched (AWS WAF answers plain
    // HTTP with an empty 202) and paginated 25 at a time, so it runs hourly
    // rather than at the workflow's full cadence — 20 browser page loads is not
    // something to repeat every ten minutes for a directory that changes yearly.
    label: "NSF REU",
    adapter: "scraped",
    config: { company: "NSF REU" },
    trustedInternOnly: true,
    pollIntervalMinutes: 360,
    listKey: "summer-reu",
  },
  {
    // Microsoft Research hires separately from Microsoft proper and publishes
    // nowhere else, so its research internships are missing entirely without
    // this. Unlike the feeds above it is a company board rather than a list, so
    // it carries no listKey — the Alerts tab groups it under the "Microsoft
    // Research" watched_company entry — and trustedInternOnly stays false so the
    // strict intern-token rule applies like it does to any other employer.
    //
    // Hourly rather than at the workflow's full cadence: this is a lab's
    // WordPress site, not an ATS built to be polled, and a research internship
    // stays open for weeks. The adapter's compact-view revision check means a
    // poll that finds nothing new costs ~12KB.
    label: "Microsoft Research",
    adapter: "msr",
    config: { company: "Microsoft Research" },
    trustedInternOnly: false,
    pollIntervalMinutes: 60,
    listKey: null,
  },
] as const;
