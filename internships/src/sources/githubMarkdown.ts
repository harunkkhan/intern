// Repos that curate opportunities in README tables rather than a JSON file.
//
// zapplyjobs/underclassmen-internships is a directory of *programs* — "NASA",
// "Microsoft Explore (Freshman)", "EA Pathfinder" — not individual postings, so
// a new row means a newly-tracked program rather than a newly-opened req. Still
// worth alerting on, just a different granularity from the job feeds.
//
// config: { repo: "owner/name", path: "README.md" }

import { getJson, getText } from "../http.ts";
import { termFromTitle } from "../normalize.ts";
import { requireString, type Adapter, type RawListing } from "../types.ts";

interface CommitEntry {
  sha?: string;
}

/** `[Label](https://example.com)` → the two parts. */
const MD_LINK = /\[([^\]]+)\]\(\s*<?([^)\s>]+)\s*>?\s*\)/;

function stripMarkdown(cell: string): string {
  return cell
    .replace(MD_LINK, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;

export const githubMarkdown: Adapter = async (config, ctx) => {
  const repo = requireString(config, "repo");
  const path = requireString(config, "path");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const commits = await getJson<CommitEntry[]>(
    `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`,
    { headers },
  );
  const sha = commits[0]?.sha;
  if (!sha) throw new Error(`no commits found for ${repo}:${path}`);
  if (ctx.lastSha === sha) return { listings: [], sha, unchanged: true };

  const markdown = await getText(
    `https://raw.githubusercontent.com/${repo}/${sha}/${path}`,
  );

  // The README carries several tables under different headings (Internships,
  // Fellowships, Winternships, …). The heading is tracked so it can be recorded
  // as the category.
  let section = "";
  let header: string[] | null = null;
  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading?.[1]) {
      section = stripMarkdown(heading[1]);
      header = null;
      continue;
    }

    if (!line.startsWith("|") || line.split("|").length < 3) {
      // A blank or prose line ends the current table.
      if (!line) header = null;
      continue;
    }
    if (SEPARATOR_ROW.test(line)) continue;

    const cells = splitRow(line);
    if (!header) {
      header = cells.map((c) => stripMarkdown(c).toLowerCase());
      continue;
    }

    const nameCell = cells[0] ?? "";
    const link = nameCell.match(MD_LINK);
    // A row with no link has nothing to apply to, so it can't become a listing.
    if (!link?.[2]) continue;
    const url = link[2].trim();
    if (!/^https?:\/\//i.test(url)) continue;

    const title = stripMarkdown(nameCell);
    if (!title || title.length > 200) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    // Remaining columns vary by table; record them as context rather than
    // pretending to a fixed schema.
    const extras = header
      .slice(1)
      .map((h, i) => {
        const value = stripMarkdown(cells[i + 1] ?? "");
        return value && value !== "?" ? `${h}: ${value}` : "";
      })
      .filter(Boolean);

    listings.push({
      externalId: url,
      company: title,
      title,
      url,
      locations: null,
      term: termFromTitle(title),
      sponsorship: null,
      category: [section, ...extras].filter(Boolean).join(" · ") || null,
      postedAt: null,
    });
  }

  if (listings.length === 0) {
    // An empty parse looks identical to "no programs listed" and would
    // deactivate everything this source has. Fail loudly.
    throw new Error(
      `no linked table rows parsed from ${repo}:${path} — README format probably changed`,
    );
  }
  return { listings, sha };
};
