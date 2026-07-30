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

import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { closeDb, db, hasDatabase, schema } from "./db.ts";
import { filterListing, termFloor, type FilterVerdict } from "./filter.ts";
import {
  formatCompanyDigest,
  formatIntro,
  type DigestListing,
} from "./message.ts";
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

/** Postings drained per subscriber per run. Extras stay pending for next time. */
const MAX_DELIVERIES_PER_RUN = 40;
/** Companies texted about per subscriber per run, since each is its own message. */
const MAX_MESSAGES_PER_RUN = 10;

/**
 * Postings first seen before this are never alerted on, only recorded.
 *
 * Everything already in the database was gathered while building this out, and
 * none of it should arrive as a notification. Mirrors the TRACK_AFTER convention
 * the Gmail sync already uses.
 */
function alertStart(): Date {
  const raw = process.env.ALERT_START?.trim() || "2026-07-29";
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`ALERT_START="${raw}" is not a YYYY-MM-DD date`);
  }
  return parsed;
}

/**
 * How old a posting may be, by the company's own posting date, and still alert.
 *
 * ALERT_START alone is not enough. It gates on when *we* first saw a listing, so
 * adding or fixing a source makes its whole backlog new-to-us and eligible —
 * which is how a Salesforce role posted on 16 May arrived as a notification 74
 * days later. Postings whose source reports no date are unaffected, since for
 * them first_seen is the only signal there is.
 */
const MAX_POSTING_AGE_DAYS = 7;
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
        pollIntervalMinutes: source.pollIntervalMinutes,
        listKey: source.listKey,
      })
      .onConflictDoUpdate({
        target: [jobSources.label, jobSources.adapter],
        set: {
          config: source.config,
          trustedInternOnly: source.trustedInternOnly,
          pollIntervalMinutes: source.pollIntervalMinutes,
          listKey: source.listKey,
        },
      });
  }
}

async function loadSources(
  only: string | null,
  ignoreInterval: boolean,
): Promise<SourceRow[]> {
  const rows = await db
    .select()
    .from(jobSources)
    .where(eq(jobSources.enabled, true))
    .orderBy(asc(jobSources.label));

  const filtered = only ? rows.filter((r) => r.label === only) : rows;
  if (ignoreInterval || only) return filtered;

  // The workflow fires every 10 minutes, but each source declares how often it
  // actually wants to be hit, and a failing source backs off on top of that.
  const now = Date.now();
  return filtered.filter(
    (r) =>
      r.lastPolledAt === null ||
      now - r.lastPolledAt.getTime() >= effectiveIntervalMs(r),
  );
}

/** Poll interval, doubled per consecutive failure and capped at 24h. */
function effectiveIntervalMs(source: SourceRow): number {
  const base = source.pollIntervalMinutes * 60_000;
  const backoff = 2 ** Math.min(source.consecutiveFailures, 7);
  return Math.min(base * backoff, 24 * 60 * 60_000);
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
  // Keyed on seededAt, not lastPolledAt: a failed attempt advances the retry
  // clock but must not burn the one-time seeding grace.
  const firstRun = source.seededAt === null;
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
          // "Unchanged" is a successful poll — the source answered, its content
          // just hadn't moved — so it clears the failure streak like any success.
          .set({
            lastPolledAt: new Date(),
            seededAt: source.seededAt ?? new Date(),
            lastError: null,
            consecutiveFailures: 0,
          })
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
            // Refreshed, not just written on insert, so a change to the
            // normalization rules can be corrected with `--refetch` instead of
            // leaving old rows permanently unmatchable.
            company: sql`excluded.company`,
            normalizedCompany: sql`excluded.normalized_company`,
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
        seededAt: source.seededAt ?? new Date(),
        lastError: null,
        consecutiveFailures: 0,
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
      // lastPolledAt is bumped on failure too, so a permanently-broken source
      // backs off instead of being retried every run forever. seededAt is left
      // alone, which is what keeps the one-time seeding grace intact for a source
      // whose first successful poll comes after some failed ones.
      await db
        .update(jobSources)
        .set({
          lastError: message,
          lastPolledAt: new Date(),
          consecutiveFailures: source.consecutiveFailures + 1,
        })
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
      aliases: watchedCompanies.aliases,
    })
    .from(watchedCompanies)
    .where(eq(watchedCompanies.enabled, true));
  const watchlistByUser = new Map<string, Set<string>>();
  for (const row of watched) {
    const set = watchlistByUser.get(row.userId) ?? new Set<string>();
    set.add(row.normalizedName);
    // Aliases are stored already normalized, so they drop straight into the same
    // lookup set as the canonical name.
    for (const alias of row.aliases ?? []) set.add(alias);
    watchlistByUser.set(row.userId, set);
  }

  const listings: {
    id: string;
    normalizedCompany: string;
    dedupeKey: string;
  }[] = [];
  const since = alertStart();
  const maxAge = new Date(
    Date.now() - MAX_POSTING_AGE_DAYS * 24 * 60 * 60 * 1000,
  );
  for (const chunk of chunks(listingIds, CHUNK)) {
    listings.push(
      ...(await db
        .select({
          id: jobListings.id,
          normalizedCompany: jobListings.normalizedCompany,
          dedupeKey: jobListings.dedupeKey,
        })
        .from(jobListings)
        .where(
          and(
            inArray(jobListings.id, chunk),
            // Anything gathered before the cutoff is history, not news. Without
            // this, re-seeding or a widened filter could resurface hundreds of
            // already-known postings as fresh alerts.
            gte(jobListings.firstSeenAt, since),
            // And where the company tells us when it posted, respect that: a
            // listing we only just discovered can still be months old.
            or(
              isNull(jobListings.postedAt),
              gte(jobListings.postedAt, maxAge),
            ),
          ),
        )),
    );
  }
  if (listings.length === 0) return 0;

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

    // One message per company. Grouping is by display name rather than the
    // normalized form so the text reads the way the employer writes it.
    const byCompany = new Map<
      string,
      { listings: DigestListing[]; ids: string[] }
    >();
    for (const row of pending) {
      const group = byCompany.get(row.company) ?? { listings: [], ids: [] };
      group.listings.push({
        company: row.company,
        title: row.title,
        url: row.url,
        locations: row.locations,
        term: row.term,
      });
      group.ids.push(row.deliveryId);
      byCompany.set(row.company, group);
    }

    // A quiet day is a couple of companies; a backlog could be dozens, and each
    // one is now its own text. The rest stay pending and drain next run.
    const groups = [...byCompany.entries()].slice(0, MAX_MESSAGES_PER_RUN);
    const held = byCompany.size - groups.length;
    if (held > 0) {
      console.log(`  holding ${held} more compan(ies) for ${subscriber.label}`);
    }

    for (const [company, group] of groups) {
      try {
        await messenger.send(
          subscriber.phone,
          formatCompanyDigest(company, group.listings, {
            siteUrl: process.env.ALERT_SITE_URL ?? null,
          }),
        );
        await db
          .update(alertDeliveries)
          .set({
            status: "sent",
            sentAt: new Date(),
            attempts: sql`${alertDeliveries.attempts} + 1`,
            error: null,
          })
          .where(inArray(alertDeliveries.id, group.ids));
        notified += group.ids.length;
        console.log(
          `  sent ${group.ids.length} ${company} posting(s) to ${subscriber.label}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Marked per company, so one failed send doesn't strand the others.
        await db
          .update(alertDeliveries)
          .set({
            status: "failed",
            attempts: sql`${alertDeliveries.attempts} + 1`,
            error: message,
          })
          .where(inArray(alertDeliveries.id, group.ids));
        console.error(
          `  ${company} -> ${subscriber.label} failed: ${message}`,
        );
      }
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
    } onward · alerting on postings first seen from ${
      alertStart().toISOString().slice(0, 10)
    }`,
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
        pollIntervalMinutes: s.pollIntervalMinutes,
        enabled: true,
        lastSha: null,
        lastPolledAt: null,
        seededAt: null,
        lastError: null,
        consecutiveFailures: 0,
        listKey: s.listKey,
        createdAt: new Date(),
      }));
    } else {
      await ensureBuiltinSources();
      sources = await loadSources(args.only, args.refetch);
    }

    if (sources.length === 0) {
      console.log("no sources due this run");
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
