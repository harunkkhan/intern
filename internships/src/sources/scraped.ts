// Bridge to the Python scrapers for companies that run their own job board.
//
// Those companies have no ATS API to read — Databricks' postings exist only on
// databricks.com — so the page has to be rendered and parsed. Playwright and
// BeautifulSoup live in ../../scrapers; this adapter shells out and reads the
// JSON they print.
//
// Splitting it this way keeps a single implementation of the rules that matter:
// Python fetches and parses raw fields, while term parsing, filtering,
// deduplication and delivery all stay here. Nothing about internships, terms, or
// alerting is duplicated in Python.
//
// config: { company: "Databricks" }  — must match a name in scrapers/registry.py

import { spawn } from "node:child_process";
import { termFromTitle } from "../normalize.ts";
import { requireString, type Adapter, type RawListing } from "../types.ts";

// Rendering a career page in Chromium takes ~5s, and a slow site plus retries can
// stack up; well beyond that means something is wrong.
const TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

interface ScrapedRow {
  externalId?: string;
  company?: string;
  title?: string;
  url?: string;
  locations?: string[] | null;
  sponsorship?: string | null;
  category?: string | null;
  postedAt?: string | null;
}

function runScraper(company: string): Promise<string> {
  const python = process.env.PYTHON_BIN ?? "python3";
  const cwd = process.env.SCRAPERS_DIR ?? "../scrapers";

  return new Promise((resolve, reject) => {
    const child = spawn(python, ["scrape.py", "--company", company], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    let bytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`scraper for ${company} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error(`scraper for ${company} produced too much output`));
        return;
      }
      out += chunk.toString();
    });
    // Kept for the error message: the Python side reports "page markup probably
    // changed" here, which is the diagnosis worth surfacing to source health.
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-2000);
    });

    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `could not run "${python} scrape.py" in ${cwd}: ${e.message}. ` +
            "Install scrapers/requirements.txt and set PYTHON_BIN if needed.",
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `scraper exited with code ${code}`));
    });
  });
}

export const scraped: Adapter = async (config) => {
  const company = requireString(config, "company");
  const stdout = await runScraper(company);

  let rows: ScrapedRow[];
  try {
    rows = JSON.parse(stdout) as ScrapedRow[];
  } catch {
    throw new Error(
      `scraper for ${company} did not return JSON: ${stdout.slice(0, 200)}`,
    );
  }

  const listings: RawListing[] = [];
  for (const r of rows) {
    if (!r.externalId || !r.title || !r.url) continue;
    const postedAt = r.postedAt ? new Date(r.postedAt) : null;
    listings.push({
      externalId: r.externalId,
      company: r.company ?? company,
      title: r.title,
      url: r.url,
      locations: r.locations?.length ? r.locations : null,
      // Parsed here rather than in Python so there is one term parser. Scraped
      // pages routinely carry the cycle in the title — Databricks' "Product
      // Management Intern (Summer 2027)" — and leaving it null would discard it.
      term: termFromTitle(r.title),
      sponsorship: r.sponsorship ?? null,
      category: r.category ?? null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    });
  }
  return { listings };
};
