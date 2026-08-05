// Upserts the checked-in company lists into watched_company for one user.
//
//   bun src/seed-watchlist.ts you@gmail.com
//   bun src/seed-watchlist.ts you@gmail.com --list=fortune500
//
// Idempotent: re-running updates tiers and aliases without duplicating rows.
// Safe to run against a live database — adding a watchlist entry cannot itself
// trigger alerts, because only listings first seen *after* a source's initial
// poll are ever notifiable.

import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "./db.ts";
import { normalizeCompany } from "./normalize.ts";
import { WATCHLIST } from "./watchlist-seed.ts";
import { FORTUNE_500 } from "./fortune500-seed.ts";

// `listKey` is what groups a row in the Alerts tab, and it is the only thing
// separating the hand-tiered list from the Fortune 500 — matching itself doesn't
// care which list a company came from, so keeping them in one table means a
// company on both lists is one row and one alert, not two.
const LISTS = [
  { key: "harun", companies: WATCHLIST },
  { key: "fortune500", companies: FORTUNE_500 },
] as const;

const { watchedCompanies, googleTokens, jobListings } = schema;

const email = process.argv[2];
if (!email || email.startsWith("--")) {
  console.error(
    "usage: bun src/seed-watchlist.ts you@gmail.com [--list=harun|fortune500]",
  );
  process.exit(1);
}

const only = process.argv
  .slice(3)
  .find((a) => a.startsWith("--list="))
  ?.slice("--list=".length);
const lists = only ? LISTS.filter((l) => l.key === only) : LISTS;
if (lists.length === 0) {
  console.error(
    `unknown list "${only}" — expected one of: ${LISTS.map((l) => l.key).join(", ")}`,
  );
  process.exit(1);
}

try {
  const [owner] = await db
    .select({ userId: googleTokens.userId })
    .from(googleTokens)
    .where(eq(googleTokens.email, email))
    .limit(1);
  if (!owner) {
    throw new Error(`no user found for ${email} — sign in to the app once first`);
  }

  // A company on both lists must stay one row: watched_company is unique on
  // (user, normalized_name), and the hand-assigned tier is the more useful of
  // the two, so the earlier list wins and the Fortune 500 only fills gaps.
  const claimed = new Set<string>();

  for (const list of lists) {
    let inserted = 0;
    let skipped = 0;

    for (const company of list.companies) {
      const normalizedName = normalizeCompany(company.name);
      if (!normalizedName) {
        console.warn(`  skipped "${company.name}" — normalizes to nothing`);
        continue;
      }
      if (claimed.has(normalizedName)) {
        skipped++;
        continue;
      }
      claimed.add(normalizedName);

      // Aliases are stored normalized so the poller can drop them straight into
      // its lookup set. Drop any that collapse onto the canonical name.
      const aliases = [
        ...new Set(
          (company.aliases ?? [])
            .map(normalizeCompany)
            .filter((a) => a && a !== normalizedName),
        ),
      ];

      await db
        .insert(watchedCompanies)
        .values({
          userId: owner.userId,
          name: company.name,
          normalizedName,
          tier: company.tier,
          listKey: list.key,
          aliases: aliases.length ? aliases : null,
        })
        .onConflictDoUpdate({
          target: [watchedCompanies.userId, watchedCompanies.normalizedName],
          set: {
            name: company.name,
            tier: company.tier,
            listKey: list.key,
            aliases: aliases.length ? aliases : null,
          },
        });
      inserted++;
    }

    console.log(
      `${list.key}: upserted ${inserted}` +
        (skipped ? ` (${skipped} already on an earlier list)` : ""),
    );
  }

  // Immediate feedback on whether the names actually resolve against real data.
  // A watchlist entry that matches nothing is the silent failure mode here.
  const rows = await db
    .select({
      normalizedCompany: jobListings.normalizedCompany,
    })
    .from(jobListings)
    .where(eq(jobListings.active, true));
  const seen = new Set(rows.map((r) => r.normalizedCompany));

  const watched = await db
    .select({
      name: watchedCompanies.name,
      normalizedName: watchedCompanies.normalizedName,
      aliases: watchedCompanies.aliases,
    })
    .from(watchedCompanies)
    .where(eq(watchedCompanies.userId, owner.userId));

  const unmatched = watched
    .filter(
      (w) =>
        !seen.has(w.normalizedName) &&
        !(w.aliases ?? []).some((a) => seen.has(a)),
    )
    .map((w) => w.name);

  console.log(
    `${watched.length - unmatched.length}/${watched.length} match at least one active listing`,
  );
  if (unmatched.length) {
    console.log(
      "\nno active listing currently matches these (may just mean nothing is open):",
    );
    for (const name of unmatched) console.log(`  ${name}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
