// Postgres client for the Discord sender.
//
// The schema is imported from the web app rather than duplicated — the web app
// owns drizzle-kit and the migrations, and this process only reads job_listing
// and writes the alert_delivery rows the poller reserved for it.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";

const connectionString = process.env.DATABASE_URL;

export const hasDatabase = !!connectionString;

// Mirrors internships/src/db.ts: fall back to a placeholder that postgres-js only
// dials on the first query, so importing this module is always safe.
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
