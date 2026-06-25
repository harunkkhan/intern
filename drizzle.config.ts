import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations should run against a direct (non-pooled) connection.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
