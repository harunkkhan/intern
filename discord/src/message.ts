// Digest formatting for Discord.
//
// Deliberately not shared with internships/src/message.ts. iMessage takes one
// unbounded plain-text blob; Discord takes markdown, caps a message at 2,000
// characters, and turns bare links into unfurled cards. The two formats have
// almost no overlap beyond the field list, and folding them into one function
// with a `style` flag would make both harder to read than keeping them apart.

import { DISCORD_MAX_CONTENT } from "../../src/lib/discordWebhook.ts";

export interface DigestListing {
  /** alert_delivery.id — carried through so a sent message can settle its rows. */
  deliveryId: string;
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  term: string | null;
}

export interface DigestMessage {
  content: string;
  /** The deliveries this message accounts for, marked 'sent' once it lands. */
  deliveryIds: string[];
  /**
   * Role ids this message's mention text should actually notify.
   *
   * Carried alongside the content rather than decided by the sender, so the
   * `<@&id>` in the text and the permission to act on it are set in one place
   * and can't drift apart — a mention posted without matching `allowed_mentions`
   * renders as a highlighted but silent ping, which looks like it worked.
   */
  mentionRoleIds: string[];
}

/**
 * Room set aside for the heading, which doesn't exist yet when blocks are being
 * packed. Over-reserving costs at most one extra message on a very full run;
 * under-reserving costs a 400 from Discord.
 */
const HEADING_RESERVE = 80;
const SEPARATOR = "\n\n";

/** Backslash-escapes the characters Discord would otherwise read as markup. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|[\]])/g, "\\$1");
}

/**
 * Renders a link as `[text](<url>)`.
 *
 * The angle brackets are not decoration: without them a `)` anywhere in the URL
 * terminates the markdown link early, and Greenhouse and Workday both emit
 * parenthesised paths. They also suppress the per-link unfurl, which `flags`
 * covers at the message level too — belt and braces, since a digest of forty
 * links unfurled is unreadable.
 */
function link(text: string, url: string): string {
  const safe = url.replace(/[<>\s]/g, encodeURIComponent);
  return `[${escapeMarkdown(text)}](<${safe}>)`;
}

function blockFor(listing: DigestListing): string {
  const meta = [listing.term, listing.locations?.slice(0, 2).join(" · ")]
    .filter(Boolean)
    .join(" — ");
  // `-# ` is Discord's subtext: smaller and muted. Term and location are context
  // for the link above, and at full weight forty of them read as a wall.
  return (
    `• ${link(`${listing.company} — ${listing.title}`, listing.url)}` +
    (meta ? `\n-# ${escapeMarkdown(meta)}` : "")
  );
}

/**
 * Splits a digest into messages that each fit Discord's 2,000-character cap.
 *
 * Messages are the unit of settlement, not the run: each one carries the ids it
 * covers so the caller can mark exactly those rows 'sent' the moment it lands.
 * Packing the whole digest into one atomic all-or-nothing send would mean a
 * failure on the third message either loses the first two or re-posts them on
 * the next poll.
 */
export function buildDigest(
  listings: DigestListing[],
  options: { footer?: string | null; mentionRoleId?: string | null } = {},
): DigestMessage[] {
  if (listings.length === 0) return [];

  const footer = options.footer?.trim() || null;
  // A role id, not a role name. `@job` typed literally is inert text in Discord;
  // only `<@&id>` is a mention. Unset means post silently — never fall back to
  // a broader ping than was asked for.
  const roleId = options.mentionRoleId?.trim() || null;
  const budget =
    DISCORD_MAX_CONTENT -
    HEADING_RESERVE -
    (footer ? footer.length + SEPARATOR.length : 0);

  const groups: { blocks: string[]; ids: string[]; length: number }[] = [];
  for (const listing of listings) {
    let block = blockFor(listing);
    // One posting that alone overruns a whole message. Nothing real should hit
    // this, but dropping the row silently would be worse than a clipped line.
    if (block.length > budget) block = `${block.slice(0, budget - 1)}…`;

    const current = groups.at(-1);
    const added = current ? SEPARATOR.length + block.length : block.length;
    if (current && current.length + added <= budget) {
      current.blocks.push(block);
      current.ids.push(listing.deliveryId);
      current.length += added;
    } else {
      groups.push({
        blocks: [block],
        ids: [listing.deliveryId],
        length: block.length,
      });
    }
  }

  const total = listings.length;
  return groups.map((group, index) => {
    // Only the first message pings. A digest that overflows into three posts is
    // still one batch of news, and three notifications for it would train people
    // to mute the channel — which defeats the point of pinging at all.
    const first = index === 0;
    const mention = first && roleId ? `<@&${roleId}> ` : "";
    const heading =
      mention +
      `**${total} new internship${total === 1 ? "" : "s"}**` +
      (groups.length > 1 ? ` · ${index + 1}/${groups.length}` : "");
    const isLast = index === groups.length - 1;
    return {
      content: [
        heading,
        "",
        group.blocks.join(SEPARATOR),
        ...(footer && isLast ? ["", footer] : []),
      ]
        .join("\n")
        .trim(),
      deliveryIds: group.ids,
      mentionRoleIds: mention ? [roleId!] : [],
    };
  });
}

/** An iMessage recipient whose texts aren't getting through. */
export interface FailingRecipient {
  phone: string;
  failed: number;
}

/** Beyond this the notice would crowd out the postings it's attached to. */
const MAX_LISTED = 8;

/**
 * A footer naming the phone numbers whose alerts are failing, so the people in
 * the channel who aren't getting texts find out here instead of just going
 * quiet.
 *
 * The numbers are printed in full, at the owner's explicit instruction. Anyone
 * who can read the channel can read them.
 *
 * There is deliberately no number to text: whichever line Spectrum sent from is
 * already in their message history, and naming a second one here would be a
 * number they've never seen. Replying to the thread they already have is both
 * simpler to follow and impossible to get wrong.
 */
export function formatFailingNotice(
  recipients: FailingRecipient[],
): string | null {
  if (recipients.length === 0) return null;

  const shown = recipients.slice(0, MAX_LISTED);
  const hidden = recipients.length - shown.length;
  const lines = shown.map(
    (r) =>
      `${escapeMarkdown(r.phone)} — ${r.failed} alert${r.failed === 1 ? "" : "s"} didn't send`,
  );
  if (hidden > 0) lines.push(`…and ${hidden} more`);

  return [
    "**Not getting these by text**",
    ...lines,
    "-# Reply to the last text you got from the alerts number and they'll pick back up.",
  ].join("\n");
}

/**
 * First message a channel receives. Posted before any alerts so the digests
 * don't start arriving from an unexplained webhook, and so it's on record in the
 * channel what the thing is and who can turn it off.
 *
 * Unlike the iMessage intro there is no STOP instruction: a webhook has no
 * inbound side, and everyone reading the channel would see a reply that nothing
 * is listening to. Control lives in the dashboard.
 */
export function formatIntro(label: string, scope: string): string {
  const what =
    scope === "all"
      ? "every new internship and co-op posting it finds"
      : "new internship and co-op postings from the watchlist";
  return [
    `**Internship alerts are on** — ${escapeMarkdown(label)}`,
    "",
    `This channel gets a digest whenever there's ${what}.`,
  ].join("\n");
}
