// Adapter registry. `job_source.adapter` holds one of these keys.

import type { Adapter } from "../types.ts";
import { githubJson } from "./githubJson.ts";
import { html } from "./html.ts";
import { scraped } from "./scraped.ts";
import {
  ashby,
  greenhouse,
  lever,
  smartrecruiters,
  workday,
} from "./ats.ts";

export const ADAPTERS = {
  github: githubJson,
  greenhouse,
  lever,
  ashby,
  workday,
  smartrecruiters,
  // Playwright + BeautifulSoup, for companies whose postings live only on their
  // own site. See internships/src/sources/scraped.ts.
  scraped,
  html,
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
  },
] as const;
