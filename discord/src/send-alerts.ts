// Discord sender. Run from GitHub Actions right after the poller:
//
//   bun src/send-alerts.ts              # drain pending Discord deliveries
//   bun src/send-alerts.ts --dry-run    # print the messages; no posts, no writes
//
// This bot never touches a job board. internships/src/poll.ts is the only thing
// that fetches sources, and it reserves an alert_delivery row for every enabled
// subscriber whatever their channel — so by the time this runs, the work is
// already sitting in the ledger waiting to be drained. Two pollers would mean
// two hits on every careers page for the same postings.

import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { closeDb, db, hasDatabase, schema } from "./db.ts";
import {
  buildDigest,
  formatFailingNotice,
  formatIntro,
  type DigestListing,
  type FailingRecipient,
} from "./message.ts";
import { createDryRunPoster, createPoster, type Poster } from "./webhook.ts";

const { alertSubscribers, alertDeliveries, jobListings } = schema;

/** Postings drained per channel per run. Extras stay pending for next time. */
const MAX_DELIVERIES_PER_RUN = 40;
/** Matches the poller: a delivery that has failed this often stops retrying. */
const MAX_ATTEMPTS = 3;

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

type Subscriber = typeof alertSubscribers.$inferSelect;

async function loadSubscribers(): Promise<Subscriber[]> {
  return db
    .select()
    .from(alertSubscribers)
    .where(
      and(
        eq(alertSubscribers.channel, "discord"),
        eq(alertSubscribers.enabled, true),
      ),
    );
}

/**
 * iMessage recipients with alerts that have been permanently given up on.
 *
 * Only `attempts >= MAX_ATTEMPTS` counts. A row that has failed once or twice is
 * still in the retry window and will very likely go out on the next poll —
 * naming those people would mean announcing a problem that fixes itself minutes
 * later. Once the attempt cap is hit, the poller stops picking the row up and
 * the alert really is lost, which is the point at which it's worth saying so.
 *
 * Disabled subscribers are excluded: they turned alerts off, so their deliveries
 * not going out is the system working.
 */
async function loadFailingRecipients(): Promise<FailingRecipient[]> {
  const rows = await db
    .select({
      phone: alertSubscribers.phone,
      failed: sql<number>`count(*)::int`,
    })
    .from(alertDeliveries)
    .innerJoin(
      alertSubscribers,
      eq(alertDeliveries.subscriberId, alertSubscribers.id),
    )
    .where(
      and(
        eq(alertSubscribers.channel, "imessage"),
        eq(alertSubscribers.enabled, true),
        isNotNull(alertSubscribers.phone),
        eq(alertDeliveries.status, "failed"),
        sql`${alertDeliveries.attempts} >= ${MAX_ATTEMPTS}`,
      ),
    )
    .groupBy(alertSubscribers.phone)
    .orderBy(desc(sql`count(*)`));

  return rows.flatMap((r) =>
    r.phone ? [{ phone: r.phone, failed: Number(r.failed) }] : [],
  );
}

/**
 * Drains one channel's reserved deliveries.
 *
 * Rows left 'pending' or 'failed' by an earlier run are picked up too, so a crash
 * between the poller reserving and this posting self-heals on the next run rather
 * than silently dropping the alert.
 *
 * Returns the number of postings actually delivered.
 */
async function drain(
  subscriber: Subscriber,
  poster: Poster,
  args: Args,
  footer: string | null,
): Promise<number> {
  const webhookUrl = subscriber.webhookUrl;
  if (!webhookUrl) {
    // The CHECK constraint makes this unreachable from the app, but a row edited
    // by hand shouldn't take the whole run down.
    console.error(`  ${subscriber.label}: no webhook URL — skipped`);
    return 0;
  }

  const pending = await db
    .select({
      deliveryId: alertDeliveries.id,
      company: jobListings.company,
      title: jobListings.title,
      url: jobListings.url,
      locations: jobListings.locations,
      term: jobListings.term,
    })
    .from(alertDeliveries)
    .innerJoin(jobListings, eq(alertDeliveries.listingId, jobListings.id))
    .where(
      and(
        eq(alertDeliveries.subscriberId, subscriber.id),
        inArray(alertDeliveries.status, ["pending", "failed"]),
        lt(alertDeliveries.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(desc(jobListings.firstSeenAt))
    .limit(MAX_DELIVERIES_PER_RUN);

  if (pending.length === 0) return 0;

  // Nobody should find job alerts appearing in their channel from an
  // unexplained webhook with no note of where they came from. Never pings —
  // it's an explanation, not news.
  if (!subscriber.confirmedAt) {
    await poster.post(
      webhookUrl,
      formatIntro(subscriber.label, subscriber.scope),
    );
    if (!args.dryRun) {
      await db
        .update(alertSubscribers)
        .set({ confirmedAt: new Date() })
        .where(eq(alertSubscribers.id, subscriber.id));
    }
  }

  const listings: DigestListing[] = pending.map((row) => ({
    deliveryId: row.deliveryId,
    company: row.company,
    title: row.title,
    url: row.url,
    locations: row.locations,
    term: row.term,
  }));

  let delivered = 0;
  // Settle per message, not per run. Discord caps a message at 2,000 characters,
  // so a full digest is often several posts; marking them all 'sent' only after
  // the last one would re-post everything if the third failed, and marking them
  // all 'failed' would lose what already landed.
  for (const message of buildDigest(listings, { footer })) {
    try {
      await poster.post(webhookUrl, message.content, {
        mentionEveryone: message.mentionsEveryone,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!args.dryRun) {
        await db
          .update(alertDeliveries)
          .set({
            status: "failed",
            attempts: sql`${alertDeliveries.attempts} + 1`,
            error: reason,
          })
          .where(inArray(alertDeliveries.id, message.deliveryIds));
      }
      console.error(`  ${subscriber.label}: post failed — ${reason}`);
      // The rest of this digest would almost certainly fail the same way, and
      // leaving it pending costs nothing: the next run picks it up.
      break;
    }

    if (!args.dryRun) {
      await db
        .update(alertDeliveries)
        .set({
          status: "sent",
          sentAt: new Date(),
          attempts: sql`${alertDeliveries.attempts} + 1`,
          error: null,
        })
        .where(inArray(alertDeliveries.id, message.deliveryIds));
    }
    delivered += message.deliveryIds.length;
  }

  if (delivered > 0) {
    console.log(`  ${subscriber.label}: posted ${delivered} posting(s)`);
  }
  return delivered;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!hasDatabase) {
    throw new Error(
      "DATABASE_URL is required — this bot reads the deliveries the poller reserved.",
    );
  }

  const poster = args.dryRun ? createDryRunPoster() : createPoster();

  try {
    const subscribers = await loadSubscribers();
    if (subscribers.length === 0) {
      console.log("no Discord channels configured");
      return;
    }
    console.log(
      `${args.dryRun ? "[dry run] " : ""}draining ${subscribers.length} Discord channel(s)`,
    );

    // Queried once per run, not per channel: the answer is the same for every
    // channel, and it's a join over the whole delivery table.
    const failing = await loadFailingRecipients();
    const footer = formatFailingNotice(failing);
    if (failing.length > 0) {
      console.log(
        `  ${failing.length} number(s) with alerts given up on — noting in the digest`,
      );
    }

    let delivered = 0;
    for (const subscriber of subscribers) {
      // Sequential on purpose. Channels usually share one Discord rate-limit
      // bucket per webhook but the global limit is per-IP, and the runner has
      // one; fanning out would only trade throughput for 429s.
      delivered += await drain(subscriber, poster, args, footer);
    }
    console.log(
      args.dryRun
        ? "[dry run] nothing posted, no rows updated"
        : `done — ${delivered} posting(s) delivered`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
