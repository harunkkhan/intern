// Decides whether a scraped posting is worth texting about.
//
// The rules here were validated against live data (SimplifyJobs' 1,391
// active listings plus Greenhouse/Workday boards): of 605 postings in the
// wanted terms, only 16 lacked an intern/co-op token, and every one of those 16
// was something deliberately out of scope — an apprenticeship, an AI residency,
// or an "Investment Analyst Program".

import type { RawListing } from "./types.ts";

// Internships and co-ops only. No new-grad or full-time roles.
const INTERN_TOKEN = /\b(intern|interns|internship|internships|co-?op|coops?)\b/i;

// Always applied, to every source. Three families of false positive:
//   1. Roles that *manage* interns — "Solution Architect Manager - Intern Program"
//   2. New-grad / full-time pipelines — "University Graduate, Software Engineer"
//   3. Adjacent programs that aren't internships — apprenticeships, AI
//      residencies, and PhD/MBA tracks. On Nvidia's board this single rule
//      removes 5 of 14 token matches, all of them PhD research roles.
const DISQUALIFYING =
  /\b(senior|staff|principal|director|manager|managers|lead|head|recruit\w*|mentor|new\s+grads?|new\s+graduates?|graduate\s+programs?|graduate\s+programmes?|phd|mba|apprentice\w*|residenc(?:y|ies)|residents?|high\s+school)\b/i;

// Terms to alert on. Matches the TERMS vocabulary in src/lib/types.ts minus
// "Any". Cycles outside this set are dropped, which is what discards the ~525
// active-but-expired postings (mostly Summer 2026) that the GitHub feeds still
// carry. Forward cycles (Fall 2027+) are also dropped — widen this when the
// recruiting year rolls over.
const DEFAULT_TERMS = [
  "Fall 2026",
  "Spring 2027",
  "Summer 2027",
  "Winter 2027",
] as const;

export function wantedTerms(): Set<string> {
  const raw = process.env.ALERT_TERMS;
  const values = raw
    ? raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [...DEFAULT_TERMS];
  return new Set(values);
}

export interface FilterOptions {
  /**
   * Whether the title must name an internship or co-op. False for the GitHub
   * feeds, which only ever list internships — requiring the token there would
   * drop real postings whose titles omit the word (26 of 605 in the sample).
   * True for ATS boards, which list every role a company has open.
   */
  requireInternToken: boolean;
  terms: Set<string>;
}

export type FilterVerdict =
  | { keep: true }
  | { keep: false; reason: "no-intern-token" | "disqualifying-title" | "term" };

export function filterListing(
  listing: RawListing,
  options: FilterOptions,
): FilterVerdict {
  const title = listing.title;

  if (DISQUALIFYING.test(title)) {
    return { keep: false, reason: "disqualifying-title" };
  }
  if (options.requireInternToken && !INTERN_TOKEN.test(title)) {
    return { keep: false, reason: "no-intern-token" };
  }
  // A null term means the source didn't say. Those pass rather than being
  // dropped — ~29% of SimplifyJobs' keepable listings have no parsed term, and
  // they are overwhelmingly current-cycle postings. Better a little noise than
  // a missed Summer 2027 role.
  if (listing.term !== null && !options.terms.has(listing.term)) {
    return { keep: false, reason: "term" };
  }
  return { keep: true };
}
