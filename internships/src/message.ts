// Digest formatting.
//
// One message per run holding every new posting, whatever company it came from.
// Each line names its employer, so a mixed digest still reads cleanly without
// being split across several texts.

export interface DigestListing {
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  term: string | null;
}

/**
 * Every posting in one message, newest first.
 *
 * Nothing is truncated: the point is to have all the links in one place, and the
 * per-run delivery cap already bounds how long this can get.
 */
export function formatDigest(
  listings: DigestListing[],
  options: { siteUrl?: string | null } = {},
): string {
  const total = listings.length;
  const heading = `${total} new internship${total === 1 ? "" : "s"}`;

  const blocks = listings.map((listing) => {
    const meta = [listing.term, listing.locations?.slice(0, 2).join(" · ")]
      .filter(Boolean)
      .join(" — ");
    return (
      `• ${listing.company} — ${listing.title}` +
      (meta ? `\n  ${meta}` : "") +
      `\n  ${listing.url}`
    );
  });

  return [
    heading,
    "",
    blocks.join("\n\n"),
    ...(options.siteUrl ? ["", options.siteUrl] : []),
  ]
    .join("\n")
    .trim();
}

/**
 * First message a new subscriber receives. Sent before any alerts so nobody gets
 * unexplained texts from an unknown number, and so the opt-out path is stated up
 * front rather than only living in the dashboard.
 */
export function formatIntro(label: string, scope: string): string {
  const what =
    scope === "all"
      ? "every new internship and co-op posting it finds"
      : "new internship and co-op postings from your watchlist companies";
  return [
    `Hey ${label} — internship alerts are on.`,
    "",
    `You'll get a digest whenever there's ${what}.`,
    "",
    "Reply STOP to turn these off.",
  ].join("\n");
}
