// Marks queued deliveries for postings the US-only location rule now rejects as
// 'skipped', so neither the iMessage nor the Discord sender drains them. Both only
// pick up 'pending' and 'failed' rows, and the row stays in the ledger, so the
// same job is never reserved again.
//
//   bun src/cancel-non-us-deliveries.ts           # report what would be skipped
//   bun src/cancel-non-us-deliveries.ts --apply   # skip them

import { and, eq, inArray } from "drizzle-orm";
import { closeDb, db, hasDatabase, schema } from "./db.ts";
import { failsLocation } from "./filter.ts";

const { alertDeliveries, alertSubscribers, jobListings } = schema;

const QUEUED = ["pending", "failed"];
const SAMPLES = 20;

const apply = process.argv.includes("--apply");

try {
  if (!hasDatabase) throw new Error("DATABASE_URL is required");

  const rows = await db
    .select({
      id: alertDeliveries.id,
      status: alertDeliveries.status,
      subscriber: alertSubscribers.label,
      company: jobListings.company,
      title: jobListings.title,
      locations: jobListings.locations,
    })
    .from(alertDeliveries)
    .innerJoin(jobListings, eq(alertDeliveries.listingId, jobListings.id))
    .innerJoin(alertSubscribers, eq(alertDeliveries.subscriberId, alertSubscribers.id))
    .where(inArray(alertDeliveries.status, QUEUED));

  const rejected = rows.filter((r) => failsLocation(r.title, r.locations));
  console.log(
    `${rows.length} queued deliveries · ${rejected.length} fail the US location rule`,
  );

  const bySubscriber = new Map<string, number>();
  for (const r of rejected) {
    const key = `${r.subscriber} (${r.status})`;
    bySubscriber.set(key, (bySubscriber.get(key) ?? 0) + 1);
  }
  for (const [key, n] of bySubscriber) console.log(`  ${key}: ${n}`);

  for (const r of rejected.slice(0, SAMPLES)) {
    console.log(
      `  - ${r.company} · ${r.title} · ${r.locations?.join("; ") || "no location"}`,
    );
  }

  if (apply) {
    let skipped = 0;
    for (let i = 0; i < rejected.length; i += 500) {
      const updated = await db
        .update(alertDeliveries)
        .set({ status: "skipped", error: "location" })
        .where(
          and(
            inArray(
              alertDeliveries.id,
              rejected.slice(i, i + 500).map((r) => r.id),
            ),
            inArray(alertDeliveries.status, QUEUED),
          ),
        )
        .returning({ id: alertDeliveries.id });
      skipped += updated.length;
    }
    console.log(`\nmarked ${skipped} delivery(ies) skipped`);
  } else {
    console.log(`\n(report only — re-run with --apply to mark them skipped)`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
