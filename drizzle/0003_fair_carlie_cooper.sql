ALTER TABLE "job_source" ADD COLUMN "poll_interval_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "watched_company" ADD COLUMN "tier" text;