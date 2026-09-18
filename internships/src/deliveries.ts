// Shared reserve-time guard for the alert ledger.
//
// alert_delivery is unique on (subscriber_id, dedupe_key), and that index is
// what normally collapses one job arriving from two feeds into one alert. It
// stops working the moment a delivery row's key and its listing's key disagree,
// which the poller can cause on its own: the upsert in poll.ts refreshes `url`
// and `dedupe_key` in place, so a source rewriting the apply URL of a record it
// already published moves the listing from K1 to K2 while the delivery row it
// already has keeps saying K1. A second source that later first-sees the same
// job under K2 then looks brand new to the index, and the subscriber is told
// about it twice.
//
// So ask the question the stored column can no longer answer — does this
// subscriber already hold a delivery for a listing that *is this job today* —
// by joining through listing_id and comparing against the listing's current key.

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema.ts";

const { alertDeliveries, jobListings } = schema;

const CHUNK = 500;

export interface DeliveryCandidate {
  subscriberId: string;
  dedupeKey: string;
}

/**
 * Drops the candidates whose subscriber is already covered for that job, as the
 * job is keyed right now. Read-only; callers still insert with
 * `onConflictDoNothing`, which remains the guard against a concurrent poll.
 */
export async function dropAlreadyDelivered<T extends DeliveryCandidate>(
  db: PostgresJsDatabase<typeof schema>,
  candidates: T[],
): Promise<T[]> {
  if (candidates.length === 0) return candidates;

  const subscriberIds = [...new Set(candidates.map((c) => c.subscriberId))];
  const keys = [...new Set(candidates.map((c) => c.dedupeKey))];

  const held = new Map<string, Set<string>>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const rows = await db
      .select({
        subscriberId: alertDeliveries.subscriberId,
        dedupeKey: jobListings.dedupeKey,
      })
      .from(alertDeliveries)
      .innerJoin(jobListings, eq(alertDeliveries.listingId, jobListings.id))
      .where(
        and(
          inArray(alertDeliveries.subscriberId, subscriberIds),
          inArray(jobListings.dedupeKey, keys.slice(i, i + CHUNK)),
        ),
      );
    for (const row of rows) {
      const set = held.get(row.subscriberId) ?? new Set<string>();
      set.add(row.dedupeKey);
      held.set(row.subscriberId, set);
    }
  }

  return candidates.filter((c) => !held.get(c.subscriberId)?.has(c.dedupeKey));
}
