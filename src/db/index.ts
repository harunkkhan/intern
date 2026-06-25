import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// A live connection isn't needed at build time (all pages/routes are dynamic),
// so fall back to a placeholder that postgres-js only dials on first query.
const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== "production") {
  console.warn("DATABASE_URL is not set — database calls will fail at runtime.");
}

// Reuse the client across hot-reloads in dev and warm serverless invocations
// to avoid exhausting the connection pool. `prepare: false` is required for
// Supabase's transaction pooler.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.pgClient ??
  postgres(
    connectionString ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    { prepare: false },
  );

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
