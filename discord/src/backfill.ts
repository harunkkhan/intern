// Reserves deliveries for postings already in the database, so a channel added
// after the fact can be told about the backlog rather than starting from the
// next thing that happens to appear.
//
//   bun src/backfill.ts              # report what would be reserved
//   bun src/backfill.ts --apply      # reserve it
//
// Narrowing either flag combines with the other and with --apply:
//
//   --subscriber <label-or-id>   only that Discord channel (errors on no match)
//   --since <N>h | <N>d          only listings first seen within the window
//
// Then drain it in one burst rather than 40 at a time:
//
//   DISCORD_MAX_PER_RUN=1000 bun src/send-alerts.ts
//
// This deliberately skips the two date gates poll.ts applies (ALERT_START and
// MAX_POSTING_AGE_DAYS). Those exist to stop a newly-added *source* dumping its
// whole history as notifications; here the backlog is the point. The company
// filter and the intern-title filter are still applied in full — re-applied from
// source, not trusted from the row, because a listing recorded under an older
// rule can be sitting in the table having passed a filter that no longer holds.
//
// Reserving is idempotent: alert_delivery is unique on (subscriber, dedupe_key),
// so anything already sent is skipped and re-running adds nothing. The ledger is
// read through listing_id as well, so a row whose stored key has gone stale still
// counts as covered — see internships/src/deliveries.ts.

import { and, eq, gte, or } from "drizzle-orm";
import { closeDb, db, hasDatabase, schema } from "./db.ts";
import { dropAlreadyDelivered } from "../../internships/src/deliveries.ts";
import {
  filterListing,
  termFloor,
} from "../../internships/src/filter.ts";

const { alertSubscribers, alertDeliveries, jobListings, jobSources, watchedCompanies } =
  schema;

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");

function flag(name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function parseSince(raw: string): Date {
  const match = /^(\d+)([hd])$/.exec(raw);
  if (!match) throw new Error(`--since takes <N>h or <N>d, got "${raw}"`);
  const hours = Number(match[1]) * (match[2] === "d" ? 24 : 1);
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

try {
  const subscriberArg = flag("--subscriber");
  const sinceArg = flag("--since");
  const since = sinceArg ? parseSince(sinceArg) : null;

  if (!hasDatabase) throw new Error("DATABASE_URL is required");

  const subscribers = await db
    .select()
    .from(alertSubscribers)
    .where(
      and(
        eq(alertSubscribers.channel, "discord"),
        eq(alertSubscribers.enabled, true),
        subscriberArg
          ? or(
              eq(alertSubscribers.id, subscriberArg),
              eq(alertSubscribers.label, subscriberArg),
            )
          : undefined,
      ),
    );
  if (subscriberArg && subscribers.length === 0) {
    throw new Error(`no enabled Discord channel with label or id "${subscriberArg}"`);
  }
  if (subscriberArg && subscribers.length > 1) {
    throw new Error(
      `"${subscriberArg}" matches ${subscribers.length} channels — pass the id instead`,
    );
  }
  if (subscribers.length === 0) {
    console.log("no enabled Discord channels");
  }

  const rows = await db
    .select({
      id: jobListings.id,
      company: jobListings.company,
      title: jobListings.title,
      url: jobListings.url,
      normalized: jobListings.normalizedCompany,
      dedupeKey: jobListings.dedupeKey,
      locations: jobListings.locations,
      term: jobListings.term,
      postedAt: jobListings.postedAt,
      externalId: jobListings.externalId,
      trusted: jobSources.trustedInternOnly,
    })
    .from(jobListings)
    .innerJoin(jobSources, eq(jobListings.sourceId, jobSources.id))
    .where(
      and(
        eq(jobListings.active, true),
        since ? gte(jobListings.firstSeenAt, since) : undefined,
      ),
    );

  const floor = termFloor();
  const eligible = rows.filter(
    (r) =>
      filterListing(
        {
          externalId: r.externalId,
          company: r.company,
          title: r.title,
          url: r.url,
          locations: r.locations,
          term: r.term,
          sponsorship: null,
          category: null,
          postedAt: r.postedAt,
        },
        { requireInternToken: !r.trusted, termFloor: floor },
      ).keep,
  );
  console.log(
    `${rows.length} active listings${since ? ` first seen since ${since.toISOString()}` : ""}` +
      ` · ${eligible.length} pass the intern/term/location filter`,
  );

  for (const subscriber of subscribers) {
    let matching = eligible;
    if (subscriber.scope !== "all") {
      const watched = await db
        .select({
          normalizedName: watchedCompanies.normalizedName,
          aliases: watchedCompanies.aliases,
        })
        .from(watchedCompanies)
        .where(
          and(
            eq(watchedCompanies.userId, subscriber.userId),
            eq(watchedCompanies.enabled, true),
          ),
        );
      const keys = new Set<string>();
      for (const x of watched) {
        keys.add(x.normalizedName);
        for (const a of x.aliases ?? []) keys.add(a);
      }
      matching = eligible.filter((r) => keys.has(r.normalized));
    }

    // Collapse the same job arriving from several feeds before insert: the
    // unique index would reject the duplicate anyway, but not within a single
    // statement — "cannot affect row a second time".
    const unique = new Map<string, (typeof matching)[number]>();
    for (const r of matching) unique.set(r.dedupeKey, r);

    console.log(
      `\n${subscriber.label} (scope=${subscriber.scope}): ${unique.size} eligible after dedupe`,
    );
    if (!apply) continue;

    let reserved = 0;
    const values = await dropAlreadyDelivered(
      db,
      [...unique.values()].map((r) => ({
        subscriberId: subscriber.id,
        listingId: r.id,
        dedupeKey: r.dedupeKey,
      })),
    );
    for (let i = 0; i < values.length; i += 500) {
      const inserted = await db
        .insert(alertDeliveries)
        .values(values.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: alertDeliveries.id });
      reserved += inserted.length;
    }
    console.log(
      `  reserved ${reserved} (${unique.size - reserved} already delivered or queued)`,
    );
  }

  if (!apply) console.log(`\n(report only — re-run with --apply to reserve)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
