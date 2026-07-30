// Page-size options for the Postings tab.
//
// Deliberately in their own module rather than in src/lib/alerts.ts: that file
// imports the database client, so a client component importing a *value* from it
// pulls postgres into the browser bundle and the build fails. Types are erased at
// compile time and can still come from alerts.ts; runtime values cannot.

export const POSTINGS_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_POSTINGS_PAGE_SIZE = 25;

/**
 * How recently a posting must have opened to appear on the Postings tab.
 *
 * "Opened" means the company's own posting date where the source reports one.
 * Only about two thirds of sources do — every scraped careers page and the
 * markdown repo report none at all — so for the rest the date we first saw it
 * stands in. That is a proxy, not the truth: it can only ever be later than the
 * real posting date, so a listing shown under the fallback is at most this old
 * *to us*, and may have been open longer.
 */
export const POSTINGS_WINDOW_DAYS = 7;

/**
 * Constrains a requested page size to the offered options.
 *
 * A real safeguard rather than tidiness: the value arrives from a query string,
 * so without it a request could ask for every row at once.
 */
export function normalizePageSize(value: unknown): number {
  const n = Number(value);
  return (POSTINGS_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_POSTINGS_PAGE_SIZE;
}
