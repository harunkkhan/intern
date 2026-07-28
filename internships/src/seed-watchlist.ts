// Upserts WATCHLIST into watched_company for one user.
//
//   bun src/seed-watchlist.ts you@gmail.com
//
// Idempotent: re-running updates tiers and aliases without duplicating rows.
// Safe to run against a live database — adding a watchlist entry cannot itself
// trigger alerts, because only listings first seen *after* a source's initial
// poll are ever notifiable.

import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "./db.ts";
import { normalizeCompany } from "./normalize.ts";
import { WATCHLIST } from "./watchlist-seed.ts";

const { watchedCompanies, googleTokens, jobListings } = schema;

const email = process.argv[2];
if (!email) {
  console.error("usage: bun src/seed-watchlist.ts you@gmail.com");
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

  let inserted = 0;
  const normalizedByName = new Map<string, string>();

  for (const company of WATCHLIST) {
    const normalizedName = normalizeCompany(company.name);
    if (!normalizedName) {
      console.warn(`  skipped "${company.name}" — normalizes to nothing`);
      continue;
    }
    normalizedByName.set(company.name, normalizedName);

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
        aliases: aliases.length ? aliases : null,
      })
      .onConflictDoUpdate({
        target: [watchedCompanies.userId, watchedCompanies.normalizedName],
        set: {
          name: company.name,
          tier: company.tier,
          aliases: aliases.length ? aliases : null,
        },
      });
    inserted++;
  }

  console.log(`upserted ${inserted} watchlist companies for ${email}`);

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
