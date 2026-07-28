// Poll entrypoint. Run from GitHub Actions every 10 minutes:
//
//   bun src/poll.ts               # fetch, record, alert
//   bun src/poll.ts --dry-run     # fetch and report only; no writes, no sends
//   bun src/poll.ts --refetch     # ignore the revision cache (after a rule change)
//   bun src/poll.ts --source=SimplifyJobs
//
// Ordering matters for safety. Listings are recorded first, then delivery rows
// are *reserved* as 'pending', and only then are messages sent. Because
// alert_delivery is unique on (subscriber_id, dedupe_key), a crash between
// reserve and send leaves a retryable row rather than a lost or duplicated alert.

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { closeDb, db, hasDatabase, schema } from "./db.ts";
import { filterListing, termFloor, type FilterVerdict } from "./filter.ts";
import { formatDigest, formatIntro, type DigestListing } from "./message.ts";
import { dedupeKeyFor, normalizeCompany } from "./normalize.ts";
import { BUILTIN_SOURCES, resolveAdapter } from "./sources/index.ts";
import { createDryRunMessenger, createMessenger, type Messenger } from "./send.ts";
import type { RawListing } from "./types.ts";

const {
  jobSources,
  jobListings,
  watchedCompanies,
  alertSubscribers,
  alertDeliveries,
  pollRuns,
} = schema;

/** Postings pulled into one digest. Extras stay pending and drain next run. */
const MAX_DELIVERIES_PER_RUN = 40;
const CHUNK = 500;
const SOURCE_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

interface Args {
  dryRun: boolean;
  only: string | null;
  refetch: boolean;
}

function parseArgs(argv: string[]): Args {
  let only: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--source=")) only = arg.slice("--source=".length);
  }
  return {
    dryRun: argv.includes("--dry-run"),
    only,
    refetch: argv.includes("--refetch"),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

type SourceRow = typeof jobSources.$inferSelect;

// Keeps the two community feeds present without anyone running SQL by hand.
// Config is refreshed on every run so a repo rename ships with a redeploy, but
// `enabled` is left alone — disabling a source in the UI has to stick.
async function ensureBuiltinSources(): Promise<void> {
  for (const source of BUILTIN_SOURCES) {
    await db
      .insert(jobSources)
      .values({
        label: source.label,
        adapter: source.adapter,
        config: source.config,
        trustedInternOnly: source.trustedInternOnly,
      })
      .onConflictDoUpdate({
        target: [jobSources.label, jobSources.adapter],
        set: {
          config: source.config,
          trustedInternOnly: source.trustedInternOnly,
        },
      });
  }
}

async function loadSources(only: string | null): Promise<SourceRow[]> {
  const rows = await db
    .select()
    .from(jobSources)
    .where(eq(jobSources.enabled, true))
    .orderBy(asc(jobSources.label));
  return only ? rows.filter((r) => r.label === only) : rows;
}

interface SourceOutcome {
  label: string;
  found: number;
  created: number;
  unchanged: boolean;
  seeded: boolean;
  /** Listing ids eligible to alert on. Empty on a source's first successful poll. */
  notifiable: string[];
  error: string | null;
  rejections: Map<string, number>;
}

async function pollSource(
  source: SourceRow,
  floor: number,
  args: Args,
): Promise<SourceOutcome> {
  const startedAt = new Date();
  const firstRun = source.lastPolledAt === null;
  const rejections = new Map<string, number>();
  const base: SourceOutcome = {
    label: source.label,
    found: 0,
    created: 0,
    unchanged: false,
    seeded: false,
    notifiable: [],
    error: null,
    rejections,
  };

  try {
    const adapter = resolveAdapter(source.adapter);
    // The revision cache keys on source content, not on filter rules, so a feed
    // that hasn't changed is skipped even when the filter has been widened.
    // `--refetch` forces re-evaluation after a rule change (e.g. raising
    // ALERT_TERM_FLOOR) instead of waiting for upstream to happen to change.
    const result = await adapter(source.config, {
      lastSha: args.refetch ? null : source.lastSha,
    });

    if (result.unchanged) {
      if (!args.dryRun) {
        await db
          .update(jobSources)
          .set({ lastPolledAt: new Date(), lastError: null })
          .where(eq(jobSources.id, source.id));
        await recordRun(source.id, startedAt, { skipped: true });
      }
      return { ...base, unchanged: true };
    }

    const kept: RawListing[] = [];
    for (const listing of result.listings) {
      const verdict: FilterVerdict = filterListing(listing, {
        requireInternToken: !source.trustedInternOnly,
        termFloor: floor,
      });
      if (verdict.keep) {
        kept.push(listing);
      } else {
        rejections.set(verdict.reason, (rejections.get(verdict.reason) ?? 0) + 1);
      }
    }
    base.found = kept.length;

    if (args.dryRun) {
      return { ...base, seeded: firstRun };
    }

    // A feed can repeat an id; the upsert would otherwise fail on "affect row a
    // second time" within one statement.
    const unique = new Map<string, RawListing>();
    for (const listing of kept) unique.set(listing.externalId, listing);

    const rows = [...unique.values()].map((listing) => ({
      sourceId: source.id,
      externalId: listing.externalId,
      company: listing.company,
      normalizedCompany: normalizeCompany(listing.company),
      title: listing.title,
      url: listing.url,
      dedupeKey: dedupeKeyFor(listing.company, listing.title, listing.url),
      locations: listing.locations,
      term: listing.term,
      sponsorship: listing.sponsorship,
      category: listing.category,
      postedAt: listing.postedAt,
      firstSeenAt: startedAt,
      lastSeenAt: startedAt,
      active: true,
    }));

    const insertedIds: string[] = [];
    for (const chunk of chunks(rows, CHUNK)) {
      const returned = await db
        .insert(jobListings)
        .values(chunk)
        .onConflictDoUpdate({
          target: [jobListings.sourceId, jobListings.externalId],
          set: {
            title: sql`excluded.title`,
            url: sql`excluded.url`,
            dedupeKey: sql`excluded.dedupe_key`,
            locations: sql`excluded.locations`,
            term: sql`excluded.term`,
            sponsorship: sql`excluded.sponsorship`,
            category: sql`excluded.category`,
            postedAt: sql`excluded.posted_at`,
            lastSeenAt: sql`excluded.last_seen_at`,
            active: true,
          },
        })
        // `xmax = 0` is true only for a genuinely inserted row, which is how a
        // brand-new posting is told apart from one we already knew about.
        .returning({ id: jobListings.id, inserted: sql<boolean>`(xmax = 0)` });
      for (const row of returned) if (row.inserted) insertedIds.push(row.id);
    }
    base.created = insertedIds.length;

    // Anything this source didn't return this time is gone from its feed. Safe
    // because it only runs after a successful, complete fetch — an error path
    // never reaches here and so can't mass-deactivate on a transient failure.
    await db
      .update(jobListings)
      .set({ active: false })
      .where(
        and(
          eq(jobListings.sourceId, source.id),
          lt(jobListings.lastSeenAt, startedAt),
          eq(jobListings.active, true),
        ),
      );

    await db
      .update(jobSources)
      .set({
        lastSha: result.sha ?? source.lastSha,
        lastPolledAt: new Date(),
        lastError: null,
      })
      .where(eq(jobSources.id, source.id));

    // First successful poll of a source records everything and alerts on
    // nothing. Without this, seeding SimplifyJobs would fire ~800 messages, and
    // adding a company with 800 open roles to the watchlist would do the same.
    const notifiable = firstRun ? [] : insertedIds;
    if (firstRun) {
      console.log(
        `  ${source.label}: seeded ${insertedIds.length} listings (alerts suppressed on first poll)`,
      );
    }
    await recordRun(source.id, startedAt, {
      found: kept.length,
      created: insertedIds.length,
    });
    return { ...base, seeded: firstRun, notifiable };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!args.dryRun) {
      // lastPolledAt is deliberately untouched: a source that has never
      // succeeded stays in first-run mode so its eventual first success seeds
      // quietly instead of flooding.
      await db
        .update(jobSources)
        .set({ lastError: message })
        .where(eq(jobSources.id, source.id));
      await recordRun(source.id, startedAt, { error: message });
    }
    return { ...base, error: message };
  }
}

async function recordRun(
  sourceId: string,
  startedAt: Date,
  patch: {
    found?: number;
    created?: number;
    notified?: number;
    skipped?: boolean;
    error?: string;
  },
): Promise<void> {
  await db.insert(pollRuns).values({
    sourceId,
    startedAt,
    finishedAt: new Date(),
    found: patch.found ?? 0,
    created: patch.created ?? 0,
    notified: patch.notified ?? 0,
    skipped: patch.skipped ?? false,
    error: patch.error ?? null,
  });
}

/**
 * Creates 'pending' delivery rows for every (subscriber, new listing) pair the
 * subscriber's scope allows. `onConflictDoNothing` against the unique
 * (subscriber, dedupe_key) index is what collapses the same job arriving from
 * two different feeds into a single alert.
 */
async function reserveDeliveries(listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0;

  const subscribers = await db
    .select()
    .from(alertSubscribers)
    .where(eq(alertSubscribers.enabled, true));
  if (subscribers.length === 0) return 0;

  const watched = await db
    .select({
      userId: watchedCompanies.userId,
      normalizedName: watchedCompanies.normalizedName,
    })
    .from(watchedCompanies)
    .where(eq(watchedCompanies.enabled, true));
  const watchlistByUser = new Map<string, Set<string>>();
  for (const row of watched) {
    const set = watchlistByUser.get(row.userId) ?? new Set<string>();
    set.add(row.normalizedName);
    watchlistByUser.set(row.userId, set);
  }

  const listings: {
    id: string;
    normalizedCompany: string;
    dedupeKey: string;
  }[] = [];
  for (const chunk of chunks(listingIds, CHUNK)) {
    listings.push(
      ...(await db
        .select({
          id: jobListings.id,
          normalizedCompany: jobListings.normalizedCompany,
          dedupeKey: jobListings.dedupeKey,
        })
        .from(jobListings)
        .where(inArray(jobListings.id, chunk))),
    );
  }

  const rows: {
    subscriberId: string;
    listingId: string;
    dedupeKey: string;
  }[] = [];
  for (const subscriber of subscribers) {
    const watchlist =
      subscriber.scope === "all"
        ? null
        : watchlistByUser.get(subscriber.userId) ?? new Set<string>();
    for (const listing of listings) {
      if (watchlist && !watchlist.has(listing.normalizedCompany)) continue;
      rows.push({
        subscriberId: subscriber.id,
        listingId: listing.id,
        dedupeKey: listing.dedupeKey,
      });
    }
  }

  let reserved = 0;
  for (const chunk of chunks(rows, CHUNK)) {
    const inserted = await db
      .insert(alertDeliveries)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: alertDeliveries.id });
    reserved += inserted.length;
  }
  return reserved;
}

/**
 * Drains reserved deliveries into one digest per subscriber. Also picks up rows
 * left 'pending' or 'failed' by an earlier run, so a crash between reserving and
 * sending self-heals on the next poll instead of silently dropping alerts.
 */
async function sendPending(
  messenger: Messenger,
  args: Args,
): Promise<number> {
  const subscribers = await db
    .select()
    .from(alertSubscribers)
    .where(eq(alertSubscribers.enabled, true));

  let notified = 0;
  for (const subscriber of subscribers) {
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

    if (pending.length === 0) continue;

    // Nobody should receive job alerts from an unrecognized number with no
    // explanation and no way out.
    if (!subscriber.confirmedAt) {
      await messenger.send(
        subscriber.phone,
        formatIntro(subscriber.label, subscriber.scope),
      );
      await db
        .update(alertSubscribers)
        .set({ confirmedAt: new Date() })
        .where(eq(alertSubscribers.id, subscriber.id));
    }

    const digest: DigestListing[] = pending.map((row) => ({
      company: row.company,
      title: row.title,
      url: row.url,
      locations: row.locations,
      term: row.term,
    }));
    const ids = pending.map((row) => row.deliveryId);

    try {
      await messenger.send(
        subscriber.phone,
        formatDigest(digest, { siteUrl: process.env.ALERT_SITE_URL ?? null }),
      );
      await db
        .update(alertDeliveries)
        .set({
          status: "sent",
          sentAt: new Date(),
          attempts: sql`${alertDeliveries.attempts} + 1`,
          error: null,
        })
        .where(inArray(alertDeliveries.id, ids));
      notified += ids.length;
      console.log(`  sent ${ids.length} to ${subscriber.label}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(alertDeliveries)
        .set({
          status: "failed",
          attempts: sql`${alertDeliveries.attempts} + 1`,
          error: message,
        })
        .where(inArray(alertDeliveries.id, ids));
      console.error(`  send to ${subscriber.label} failed: ${message}`);
    }
  }
  return notified;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const floor = termFloor();
  console.log(
    `${args.dryRun ? "[dry run] " : ""}terms: ${
      process.env.ALERT_TERM_FLOOR?.trim() || "Fall 2026"
    } onward`,
  );

  const messenger = args.dryRun ? createDryRunMessenger() : createMessenger();

  try {
    let sources: SourceRow[];
    if (args.dryRun && !hasDatabase) {
      // Lets the filter be validated with no database configured at all.
      console.log("no DATABASE_URL — using built-in sources only");
      sources = BUILTIN_SOURCES.map((s, i) => ({
        id: `builtin-${i}`,
        label: s.label,
        adapter: s.adapter,
        config: s.config as Record<string, unknown>,
        trustedInternOnly: s.trustedInternOnly,
        enabled: true,
        lastSha: null,
        lastPolledAt: null,
        lastError: null,
        createdAt: new Date(),
      }));
    } else {
      await ensureBuiltinSources();
      sources = await loadSources(args.only);
    }

    if (sources.length === 0) {
      console.log("no enabled sources");
      return;
    }
    console.log(`polling ${sources.length} source(s)`);

    const outcomes = await mapWithConcurrency(
      sources,
      SOURCE_CONCURRENCY,
      (source) => pollSource(source, floor, args),
    );

    for (const outcome of outcomes) {
      if (outcome.error) {
        console.error(`  ${outcome.label}: ERROR ${outcome.error}`);
      } else if (outcome.unchanged) {
        console.log(`  ${outcome.label}: unchanged (download skipped)`);
      } else {
        const rejected = [...outcome.rejections.entries()]
          .map(([reason, n]) => `${reason}=${n}`)
          .join(" ");
        console.log(
          `  ${outcome.label}: kept ${outcome.found}` +
            (args.dryRun ? "" : ` new ${outcome.created}`) +
            (rejected ? ` | dropped ${rejected}` : ""),
        );
      }
    }

    if (args.dryRun) {
      console.log("\n[dry run] no listings recorded, no messages sent");
      return;
    }

    const newIds = outcomes.flatMap((o) => o.notifiable);
    const reserved = await reserveDeliveries(newIds);
    console.log(`${newIds.length} new listing(s), ${reserved} delivery(ies) queued`);

    const notified = await sendPending(messenger, args);
    console.log(`done — ${notified} alert(s) delivered`);
  } finally {
    await messenger.close();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
