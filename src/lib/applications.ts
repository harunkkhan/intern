// Pure helpers shared by the sync pipeline, the applications API, and the
// split/merge UI. No database or Node imports, so a client component can pull
// from here too.

// Applications are keyed on company + role + cycle rather than company + role:
// the same posting reopens every term, and a Fall 2026 application is a
// different thing from the Summer 2027 one even when the title is identical. An
// unset term contributes an empty trailing segment, so filling a term in later
// changes the key — callers that set `term` must recompute this alongside it.
export function dedupeKeyFor(
  company: string,
  position: string,
  term: string | null | undefined,
): string {
  return [company, position, term ?? ""]
    .map((part) => part.toLowerCase())
    .join("::");
}

// Postgres unique_violation. Reaching this means the write collided with
// application_user_dedupe_idx, i.e. another entry already holds the same
// company + role + term for this user.
export function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export interface EventRollupInput {
  status: string;
  occurredAt: Date;
}

export interface EventRollup {
  status: string;
  appliedAt: Date;
  lastEventAt: Date;
}

// Current status is the latest event by date and the applied date is the
// earliest — the same rule sync applies one email at a time, restated for the
// case where events move between applications and the whole row has to be
// derived from scratch. Null when there is nothing left to derive from, which
// leaves the caller's existing values in place.
export function rollupEvents(
  events: EventRollupInput[],
): EventRollup | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const latest = sorted[sorted.length - 1];
  return {
    status: latest.status,
    appliedAt: sorted[0].occurredAt,
    lastEventAt: latest.occurredAt,
  };
}

// Tokens that describe the cycle/seniority/wrapping of a posting rather than the
// role itself. Stripped before comparing titles so "Software Engineer Intern"
// and "Software Engineer, Summer 2027" are recognized as the same role.
const POSITION_FILLER = new Set([
  "intern",
  "interns",
  "internship",
  "internships",
  "co",
  "op",
  "coop",
  "program",
  "programme",
  "summer",
  "fall",
  "autumn",
  "winter",
  "spring",
  "new",
  "grad",
  "graduate",
  "fulltime",
  "parttime",
  "contract",
  "temporary",
  "the",
  "a",
  "an",
  "of",
  "for",
  "role",
  "position",
  "opening",
  "req",
  "id",
  "i",
  "ii",
  "iii",
]);

function positionTokens(position: string): Set<string> {
  return new Set(
    position
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b20\d\d\b/g, " ")
      .split(/\s+/)
      .filter((w) => w && !POSITION_FILLER.has(w)),
  );
}

// Two titles match when one's distinguishing tokens are a subset of the other's
// (after filler removal) — tolerant of word order, casing, and extra qualifiers
// while still keeping genuinely different roles apart.
export function positionsMatch(a: string, b: string): boolean {
  const ta = positionTokens(a);
  const tb = positionTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

// Which existing entry a classified email belongs to, out of every entry at the
// same company. Titles are matched loosely, but the cycle is a hard boundary:
// filler removal strips season tokens, so a "Software Engineer Intern (Summer
// 2027)" confirmation is otherwise indistinguishable from the Fall 2026 entry of
// the same name. An email that names a cycle prefers an entry for that cycle,
// then one with no cycle recorded; an email that names none falls back to the
// most recently active title match, as it always has. Undefined means the email
// belongs to a new entry.
export function pickMatchingApplication<
  T extends { position: string; term: string | null; lastEventAt: Date | null },
>(candidates: T[], position: string, term: string | null): T | undefined {
  const matches = candidates
    .filter((a) => positionsMatch(a.position, position))
    .sort(
      (x, y) =>
        (y.lastEventAt?.getTime() ?? 0) - (x.lastEventAt?.getTime() ?? 0),
    );
  if (!term) return matches[0];
  return (
    matches.find((a) => a.term === term) ?? matches.find((a) => a.term === null)
  );
}

// Stricter than positionsMatch: the token sets have to be identical, not merely
// nested. Splitting needs this because subset matching is what collapsed two
// distinct roles into one entry in the first place — "AI Engineer" is a subset
// of "Applied AI Engineer, AI Hardware", so positionsMatch would reject the very
// suggestion the user is looking for.
export function positionsEquivalent(a: string, b: string): boolean {
  const ta = positionTokens(a);
  const tb = positionTokens(b);
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}
