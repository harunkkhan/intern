// Shared helpers for the Analytics tab.

// Applications whose term was never parsed out of the email still belong to a
// cycle — they just didn't say which. Counting them toward the current cycle
// keeps them from vanishing out of every term-scoped view, which for the
// tracked data is 16 of 81 applications.
export const ASSUMED_TERM = "Summer 2027";

export function effectiveTerm(app: { term: string | null }): string {
  return app.term ?? ASSUMED_TERM;
}
