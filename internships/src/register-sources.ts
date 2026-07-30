// Turns discover.py output into job_source rows.
//
//   python scrapers/discover.py --limit 30 > discovery.json
//   bun src/register-sources.ts ../discovery.json
//
// Each company lands on the adapter that matches what it actually runs:
//   strategy "scrape" -> the `scraped` adapter (Playwright + BeautifulSoup),
//                        because those postings exist only on the company's site
//   strategy "ats"    -> the adapter for that ATS, since the company's own page
//                        is a front-end for it and serves the same postings
//
// Safe to re-run: sources are keyed on (label, adapter), and a newly-created
// source has seededAt NULL, so its first poll records everything and alerts on
// nothing regardless of how many roles it finds.

import { readFileSync } from "node:fs";
import { and, eq, ne } from "drizzle-orm";
import { closeDb, db, schema } from "./db.ts";

const { jobSources } = schema;

interface DiscoveryRow {
  name: string;
  careers_url: string | null;
  strategy: "scrape" | "ats" | "unresolved" | "unavailable";
  note?: string;
  ats: string | null;
  hosts?: Record<string, number>;
  job_links?: number;
  needs_render?: boolean;
  /** Adapter + config read off the page's apply links, when it fronts an ATS. */
  board?: { adapter: string; config: Record<string, string> } | null;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: bun src/register-sources.ts <discovery.json>");
  process.exit(1);
}

try {
  const raw = readFileSync(path, "utf8");
  // discover.py writes progress to stderr, but be forgiving if they were merged.
  const start = raw.indexOf("[");
  const rows = JSON.parse(raw.slice(start)) as DiscoveryRow[];

  const interval = Number(process.env.SCRAPE_INTERVAL_MINUTES ?? 10);
  let scraped = 0;
  let ats = 0;
  const needsAttention: string[] = [];

  for (const row of rows) {
    if (row.strategy === "unavailable") {
      // A known dead end, not a scraper waiting to be fixed.
      needsAttention.push(`${row.name} — ${row.note ?? "no public board"}`);
      continue;
    }
    if (row.strategy === "unresolved") {
      needsAttention.push(`${row.name} — no listing page found`);
      continue;
    }
    // ATS sources are addressed by their board, not by a page, so a missing
    // careers_url is only disqualifying for the scraped path.
    if (row.strategy === "scrape" && !row.careers_url) {
      needsAttention.push(`${row.name} — resolved but no URL recorded`);
      continue;
    }

    // A company board lists every role a company has open, so in both branches
    // titles must name an internship or co-op to qualify.
    let adapter: string;
    let config: Record<string, unknown>;

    if (row.strategy === "ats") {
      if (!row.board) {
        needsAttention.push(
          `${row.name} — ${row.ats ?? "ats"} front-end but no board slug in its links`,
        );
        continue;
      }
      adapter = row.board.adapter;
      // Board config is spread LAST so its slug always wins. `company` means the
      // board slug for lever and smartrecruiters but a display label for the
      // others, so writing the display name over it produced
      // api.lever.co/v0/postings/Palantir — a 404. `label` carries the display
      // name for the adapters that read it.
      config = { company: row.name, label: row.name, ...row.board.config };
      ats++;
    } else {
      adapter = "scraped";
      // The discovered URL and render decision are persisted here, not left in
      // registry.py. Discovery measured them; the registry only seeds candidate
      // domains, so without this the scraper has no page to open.
      config = {
        company: row.name,
        careersUrl: row.careers_url,
        needsRender: row.needs_render ?? false,
      };
      scraped++;
    }

    await db
      .insert(jobSources)
      .values({
        label: row.name,
        adapter,
        config,
        trustedInternOnly: false,
        pollIntervalMinutes: interval,
      })
      .onConflictDoUpdate({
        target: [jobSources.label, jobSources.adapter],
        set: { config, enabled: true, pollIntervalMinutes: interval },
      });

    // Sources are keyed on (label, adapter), so moving a company to a different
    // adapter inserts a new row and leaves the old one enabled and failing
    // forever — Stripe kept scraping a page that no longer lists jobs after its
    // Greenhouse board was found. Retire the superseded rows.
    const retired = await db
      .update(jobSources)
      .set({ enabled: false, lastError: `superseded by ${adapter}` })
      .where(
        and(
          eq(jobSources.label, row.name),
          ne(jobSources.adapter, adapter),
          eq(jobSources.enabled, true),
        ),
      )
      .returning({ adapter: jobSources.adapter });
    for (const r of retired) {
      console.log(`  retired ${row.name} (${r.adapter}) — now ${adapter}`);
    }
  }

  console.log(
    `registered ${scraped} scraped + ${ats} ATS source(s) at ${interval}min`,
  );
  if (needsAttention.length) {
    console.log("\nneeds attention:");
    for (const n of needsAttention) console.log(`  ${n}`);
  }

  const all = await db
    .select({ label: jobSources.label, adapter: jobSources.adapter })
    .from(jobSources)
    .where(eq(jobSources.enabled, true));
  console.log(`\n${all.length} enabled source(s) total`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
