ALTER TABLE "job_source" ADD COLUMN "list_key" text;--> statement-breakpoint
ALTER TABLE "watched_company" ADD COLUMN "list_key" text DEFAULT 'harun' NOT NULL;--> statement-breakpoint
-- The community listing repos are the "General Github Repos" list. Company
-- boards stay NULL on purpose: those are grouped through their watched_company
-- entry rather than on their own.
UPDATE "job_source" SET "list_key" = 'general-github' WHERE "adapter" = 'github';
