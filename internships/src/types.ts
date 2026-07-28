// Shapes shared by the source adapters, the filter, and the poll pipeline.

// What every adapter returns, regardless of where it scraped from. `externalId`
// must be stable across polls for the same posting — it is the key the
// new-posting diff runs on.
export interface RawListing {
  externalId: string;
  company: string;
  title: string;
  url: string;
  locations: string[] | null;
  /** A value from TERMS in src/lib/types.ts, or null when the source is silent. */
  term: string | null;
  sponsorship: string | null;
  category: string | null;
  postedAt: Date | null;
}

export interface FetchContext {
  /** `job_source.lastSha` — adapters that can cheaply detect "nothing changed". */
  lastSha: string | null;
}

export interface FetchResult {
  listings: RawListing[];
  /** New content revision, persisted to `job_source.lastSha`. */
  sha?: string;
  /** Set when the adapter proved nothing changed and skipped the download. */
  unchanged?: boolean;
}

export type Adapter = (
  config: Record<string, unknown>,
  ctx: FetchContext,
) => Promise<FetchResult>;

// Reads a required string out of a job_source.config JSON blob. Config is
// operator-entered, so a clear error beats a downstream `undefined`.
export function requireString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`config.${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

export function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
