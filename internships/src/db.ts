// Postgres client for the poller.
//
// The schema is imported from the web app rather than duplicated — the web app
// owns drizzle-kit and the migrations, and this process only reads and writes the
// tables those migrations create.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";

const connectionString = process.env.DATABASE_URL;

/** Lets `--dry-run` work with no database configured at all. */
export const hasDatabase = !!connectionString;

// Mirrors src/db/index.ts: fall back to a placeholder that postgres-js only dials
// on the first query, so importing this module is always safe.
// A short-lived CI process, so no global caching or hot-reload guard is needed.
// `prepare: false` is required by Supabase's transaction pooler.
const client = postgres(
  connectionString ??
    "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  { prepare: false, max: 3 },
);

export const db = drizzle(client, { schema });
export { schema };

/** Postgres keeps the event loop alive; without this the Action never exits. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
