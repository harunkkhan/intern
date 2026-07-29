// Digest formatting.
//
// One message per company, not one per posting and not one combined digest. A
// text covering Netflix and Meta together is harder to scan and impossible to
// act on selectively, while a text per posting would be unusable on a busy day —
// so postings are batched within a company and split across them.

export interface DigestListing {
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  term: string | null;
}

/** Postings spelled out in full before the message collapses into "+N more". */
const MAX_DETAILED = 8;

/**
 * One company's new postings. Every listing passed here is expected to be from
 * the same employer; the caller groups them.
 */
export function formatCompanyDigest(
  company: string,
  listings: DigestListing[],
  options: { siteUrl?: string | null } = {},
): string {
  const total = listings.length;
  const heading =
    total === 1
      ? `New at ${company}`
      : `${total} new at ${company}`;

  const shown = listings.slice(0, MAX_DETAILED);
  const blocks = shown.map((listing) => {
    const meta = [listing.term, listing.locations?.slice(0, 2).join(" · ")]
      .filter(Boolean)
      .join(" — ");
    return `• ${listing.title}${meta ? `\n  ${meta}` : ""}\n  ${listing.url}`;
  });

  const remaining = total - shown.length;
  const footer: string[] = [];
  if (remaining > 0) footer.push(`+${remaining} more`);
  if (options.siteUrl) footer.push(options.siteUrl);

  return [
    heading,
    "",
    blocks.join("\n\n"),
    ...(footer.length ? ["", footer.join(" → ")] : []),
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
