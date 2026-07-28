ALTER TABLE "job_source" ADD COLUMN "seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_source" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: seeding used to be tracked by last_polled_at. Any source that has
-- already polled has already been seeded, so carry that across. Without this
-- they would all read as never-seeded and suppress one poll's worth of real
-- alerts before re-arming.
UPDATE "job_source" SET "seeded_at" = "last_polled_at" WHERE "last_polled_at" IS NOT NULL;
