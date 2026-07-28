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
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "./db.ts";

const { jobSources } = schema;

interface DiscoveryRow {
  name: string;
  careers_url: string | null;
  strategy: "scrape" | "ats" | "unresolved";
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
    if (row.strategy === "unresolved" || !row.careers_url) {
      needsAttention.push(`${row.name} — no listing page found`);
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
      config = { ...row.board.config, company: row.name };
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
