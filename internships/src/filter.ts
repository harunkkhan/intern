// Decides whether a scraped posting is worth texting about.
//
// The rules here were validated against live data (SimplifyJobs' 1,391
// active listings plus Greenhouse/Workday boards): of 605 postings in the
// wanted terms, only 16 lacked an intern/co-op token, and every one of those 16
// was something deliberately out of scope — an apprenticeship, an AI residency,
// or an "Investment Analyst Program".

import { isNorthAmerican, titleLooksForeign } from "./location.ts";
import type { RawListing } from "./types.ts";

// Internships and co-ops only. No new-grad or full-time roles.
const INTERN_TOKEN = /\b(intern|interns|internship|internships|co-?op|coops?)\b/i;

/**
 * What counts as an intern title on a community feed.
 *
 * The feeds spell student roles in ways an ATS board doesn't: ByteDance and
 * Google post "Student Researcher", John Deere posts "Part-Time Student", and
 * Coca-Cola posts "Extern". All are internships; none contain the word.
 *
 * Deliberately excludes "fellow". Anthropic's Fellows Program is arguably one of
 * these, but so is "HOH Fellows - Spouseworks Fellows", a military-spouse
 * placement that is not a student internship — and there is nothing in a title
 * to tell them apart.
 */
const STUDENT_TOKEN =
  /\b(intern|interns|internship|internships|co-?op|coops?|student|students|extern|externship)\b/i;

// Always applied, to every source. Three families of false positive:
//   1. Roles that *manage* interns — "Solution Architect Manager - Intern Program"
//   2. New-grad / full-time pipelines — "University Graduate, Software Engineer"
//   3. Adjacent programs that aren't internships — apprenticeships, AI
//      residencies, and PhD/MBA tracks. On Nvidia's board this single rule
//      removes 5 of 14 token matches, all of them PhD research roles.
const DISQUALIFYING =
  /\b(senior|staff|principal|director|manager|managers|lead|head|recruit\w*|mentor|new\s+grads?|new\s+graduates?|graduate\s+programs?|graduate\s+programmes?|phd|mba|apprentice\w*|residenc(?:y|ies)|residents?|high\s+school)\b/i;

// The term filter is a floor, not a fixed set: anything from this cycle onward
// qualifies, and only expired cycles are dropped. That discards the ~2,100
// active-but-stale postings the GitHub feeds still carry (mostly Summer 2026)
// while letting forward cycles through without needing a list that has to be
// widened every year.
const DEFAULT_TERM_FLOOR = "Fall 2026";

// Season start months, so terms sort chronologically. This is what makes
// "Winter 2027" (January 2027) rank after "Fall 2026" but "Winter 2026" rank
// before it — the difference between an upcoming cycle and one already over.
const SEASON_MONTH: Record<string, number> = {
  winter: 1,
  spring: 4,
  summer: 7,
  fall: 10,
  autumn: 10,
};

/** Sortable position for a "Season Year" term, or null if unparseable. */
export function termOrdinal(term: string): number | null {
  const match = term.trim().match(/^(\w+)\s+(\d{4})$/);
  if (!match) return null;
  const season = match[1];
  const year = match[2];
  if (!season || !year) return null;
  const month = SEASON_MONTH[season.toLowerCase()];
  if (month === undefined) return null;
  return Number(year) * 12 + month;
}

export function termFloor(): number {
  const raw = process.env.ALERT_TERM_FLOOR?.trim() || DEFAULT_TERM_FLOOR;
  const ordinal = termOrdinal(raw);
  if (ordinal === null) {
    throw new Error(
      `ALERT_TERM_FLOOR="${raw}" is not a "Season Year" value (e.g. "Fall 2026")`,
    );
  }
  return ordinal;
}

export interface FilterOptions {
  /**
   * Whether the title must name an internship or co-op *strictly*.
   *
   * True for ATS boards, which list every role a company has open. False for the
   * community feeds, which are mostly internships — but "mostly" is the
   * operative word, and it used to mean "entirely". Those feeds now carry
   * Jane Street's "Software Engineer" and "Quantitative Trader", AMD's
   * "Analog/Mixed-Signal Serdes Design Engineer", and NRG's "Installation
   * Technician", all full-time roles that a blanket exemption waved straight
   * through.
   *
   * So the exemption is now a looser rule rather than no rule: a trusted feed
   * still has to look like a student role by STUDENT_TOKEN, which keeps
   * "Student Researcher" and "Part-Time Student" while dropping the full-time
   * ones.
   */
  requireInternToken: boolean;
  /** From `termFloor()`. Terms earlier than this are expired cycles. */
  termFloor: number;
}

export type FilterVerdict =
  | { keep: true }
  | {
      keep: false;
      reason: "no-intern-token" | "disqualifying-title" | "term" | "location";
    };

export function filterListing(
  listing: RawListing,
  options: FilterOptions,
): FilterVerdict {
  const title = listing.title;

  if (DISQUALIFYING.test(title)) {
    return { keep: false, reason: "disqualifying-title" };
  }
  // Strict on ATS boards, looser on the community feeds — but never absent.
  const token = options.requireInternToken ? INTERN_TOKEN : STUDENT_TOKEN;
  if (!token.test(title)) {
    return { keep: false, reason: "no-intern-token" };
  }
  // A null term means the source didn't say, and an unparseable one means it
  // said something we don't recognize. Both pass rather than being dropped —
  // ~29% of SimplifyJobs' keepable listings have no parsed term, and they are
  // overwhelmingly current-cycle postings. Better a little noise than a missed
  // Summer 2027 role.
  if (listing.term !== null) {
    const ordinal = termOrdinal(listing.term);
    if (ordinal !== null && ordinal < options.termFloor) {
      return { keep: false, reason: "term" };
    }
  }
  // US and Canada only. Rejects a listing only when every location it states is
  // positively identifiable as elsewhere — "Remote", "Flexible - Any Site" and a
  // missing field all pass, since dropping those would lose real US roles.
  //
  // The title is checked too, because scraped pages frequently supply no location
  // at all and then the location rule is blind: Optiver's "Quantitative Trading
  // Internship (Singapore)" reached a phone that way.
  if (!isNorthAmerican(listing.locations) || titleLooksForeign(listing.title)) {
    return { keep: false, reason: "location" };
  }
  return { keep: true };
}
