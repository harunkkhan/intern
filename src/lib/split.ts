import { format, parseISO } from "date-fns";
import { positionsEquivalent } from "@/lib/applications";
import {
  STATUS_LABELS,
  TERMS,
  type ApplicationDTO,
  type ApplicationEventDTO,
  type ApplicationStatus,
  type Term,
} from "@/lib/types";

// What a split actually does, stripped of presentation: move `eventIds` onto a
// new entry titled `position` for cycle `term`, optionally renaming what's left
// behind to `keepPosition`. Every candidate below is one of these with a label
// attached, and it is also the request body the split endpoint accepts.
export interface SplitPlan {
  position: string;
  term: Term | null;
  eventIds: string[];
  keepPosition?: string;
}

export interface SplitCandidate extends SplitPlan {
  key: string;
  group: "term" | "role" | "event";
  label: string;
  detail: string | null;
}

// A cycle named in an email. Handles the three shapes the confirmation emails
// actually use: "Summer 2027", "Fall 2026/Winter 2027" (two matches), and
// "Winter/Spring 2027" (one match, two seasons sharing a year).
const CYCLE_RE =
  /\b((?:fall|autumn|spring|summer|winter)(?:\s*[/&]\s*(?:fall|autumn|spring|summer|winter))*)\s*,?\s*(20\d\d)\b/gi;

// Gemini's summaries are formulaic — "…application for the <role> position at
// <company>" — so the role a given email is really about can be recovered even
// when the entry it landed on is titled something else. Commas are allowed
// inside the phrase because the titles themselves are comma-separated
// ("Internship, Applied AI Engineer, AI Hardware"); a sentence break is not.
//
// The trailing lookahead matters: "role" words also occur *inside* titles, as in
// "Forward Deployed Software Engineer, Internship - Commercial". Requiring the
// word to sit at a clause boundary stops the phrase being cut off mid-title.
const ROLE_RE =
  /\bfor (?:the |an |a )?([^.;:]{3,90}?)\s+(?:position|role|internship|opening)(?=\s+(?:at|for|with|and)\b|[.,;]|$)/i;

// Titles that crammed several applications into one line. Only these two
// separators — surrounded by spaces — are treated as a join, which covers
// "TPM + SWE" and "Citadel Securities | Quantitative Research" without
// mangling "Research, Analytics & Strategy Internships" into nonsense.
const TITLE_SEPARATORS = [" + ", " | "];

export function termsInEvent(e: ApplicationEventDTO): Term[] {
  const text = `${e.summary ?? ""} ${e.emailSubject ?? ""}`;
  const found = new Set<Term>();
  for (const match of text.matchAll(CYCLE_RE)) {
    for (const raw of match[1].split(/[/&]/)) {
      const season = raw.trim().toLowerCase();
      const name =
        season === "autumn" ? "Fall" : season[0].toUpperCase() + season.slice(1);
      const term = `${name} ${match[2]}`;
      // TERMS is a closed vocabulary and the column can only hold one of its
      // values, so a cycle outside it (an older "Summer 2026") is not offered.
      if ((TERMS as readonly string[]).includes(term)) found.add(term as Term);
    }
  }
  return [...found];
}

function roleInEvent(e: ApplicationEventDTO): string | null {
  const phrase = e.summary
    ?.match(ROLE_RE)?.[1]
    ?.trim()
    .replace(/[\s,\-–]+$/, "");
  return phrase && phrase.length >= 3 ? phrase : null;
}

// Everything the user could peel off this entry, in the order the menu shows it:
// cycles named in the timeline, then roles (from a joined title or from the
// emails themselves), then individual emails as an escape hatch.
export function splitCandidates(app: ApplicationDTO): SplitCandidate[] {
  return [
    ...termCandidates(app),
    ...roleCandidates(app),
    ...eventCandidates(app),
  ];
}

function termCandidates(app: ApplicationDTO): SplitCandidate[] {
  const byTerm = new Map<Term, string[]>();
  for (const e of app.events) {
    for (const term of termsInEvent(e)) {
      // Events naming the cycle this entry is already for stay where they are.
      if (term === app.term) continue;
      byTerm.set(term, [...(byTerm.get(term) ?? []), e.id]);
    }
  }

  return [...byTerm.entries()]
    // Moving every event out is a rename, not a split — the Term field on the
    // details form already does that.
    .filter(([, ids]) => ids.length < app.events.length)
    .map(([term, eventIds]) => ({
      key: `term:${term}`,
      group: "term" as const,
      label: term,
      detail: eventCount(eventIds.length),
      position: app.position,
      term,
      eventIds,
    }));
}

function roleCandidates(app: ApplicationDTO): SplitCandidate[] {
  const candidates: SplitCandidate[] = [];

  const separator = TITLE_SEPARATORS.find((s) => app.position.includes(s));
  if (separator) {
    const parts = app.position
      .split(separator)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) {
        candidates.push({
          key: `title:${part}`,
          group: "role",
          label: part,
          detail: "from the title",
          position: part,
          term: app.term,
          // The emails can't be attributed to one half of a joined title, so
          // they stay with the original — which keeps the other parts.
          eventIds: [],
          keepPosition: parts.filter((p) => p !== part).join(separator),
        });
      }
    }
  }

  const byRole = new Map<string, string[]>();
  for (const e of app.events) {
    const role = roleInEvent(e);
    if (!role || positionsEquivalent(role, app.position)) continue;
    byRole.set(role, [...(byRole.get(role) ?? []), e.id]);
  }

  for (const [role, eventIds] of byRole) {
    if (eventIds.length >= app.events.length) continue;
    if (candidates.some((c) => positionsEquivalent(c.label, role))) continue;
    const moved = app.events.filter((e) => eventIds.includes(e.id));
    const terms = new Set(moved.flatMap(termsInEvent));
    candidates.push({
      key: `role:${role}`,
      group: "role",
      label: role,
      detail: `${eventCount(eventIds.length)} · from the emails`,
      position: role,
      // Only adopt a cycle the moved emails agree on; otherwise inherit.
      term: terms.size === 1 ? [...terms][0] : app.term,
      eventIds,
    });
  }

  return candidates;
}

function eventCandidates(app: ApplicationDTO): SplitCandidate[] {
  if (app.events.length < 2) return [];
  return [...app.events]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((e) => {
      const terms = termsInEvent(e);
      return {
        key: `event:${e.id}`,
        group: "event" as const,
        label: `${format(parseISO(e.occurredAt), "MMM d")} · ${
          STATUS_LABELS[e.status as ApplicationStatus] ?? e.status
        }`,
        detail: e.summary ?? e.emailSubject,
        position: app.position,
        term: terms.length === 1 ? terms[0] : app.term,
        eventIds: [e.id],
      };
    });
}

function eventCount(n: number): string {
  return `${n} event${n === 1 ? "" : "s"}`;
}
