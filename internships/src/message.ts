// Digest formatting.
//
// One message per subscriber per run, not one per posting — even a normal day can
// surface dozens of new listings across the feeds, and a text each would be
// unusable.

export interface DigestListing {
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  term: string | null;
}

/** Listings spelled out in full before the message collapses into "+N more". */
const MAX_DETAILED = 8;

export function formatDigest(
  listings: DigestListing[],
  options: { siteUrl?: string | null } = {},
): string {
  const total = listings.length;
  const heading = `${total} new internship${total === 1 ? "" : "s"}`;

  const shown = listings.slice(0, MAX_DETAILED);
  const byCompany = new Map<string, DigestListing[]>();
  for (const listing of shown) {
    const group = byCompany.get(listing.company) ?? [];
    group.push(listing);
    byCompany.set(listing.company, group);
  }

  const blocks: string[] = [];
  for (const [company, group] of byCompany) {
    const lines = [company];
    for (const listing of group) {
      const meta = [listing.term, listing.locations?.slice(0, 2).join(" · ")]
        .filter(Boolean)
        .join(" — ");
      lines.push(`• ${listing.title}${meta ? `\n  ${meta}` : ""}`);
      lines.push(`  ${listing.url}`);
    }
    blocks.push(lines.join("\n"));
  }

  const remaining = total - shown.length;
  const footer: string[] = [];
  if (remaining > 0) {
    footer.push(`+${remaining} more`);
  }
  if (options.siteUrl) {
    footer.push(options.siteUrl);
  }

  return [heading, "", blocks.join("\n\n"), ...(footer.length ? ["", footer.join(" → ")] : [])]
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
