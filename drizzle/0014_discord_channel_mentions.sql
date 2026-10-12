ALTER TABLE "alert_subscriber" ADD COLUMN "mention_role_id" text;--> statement-breakpoint
ALTER TABLE "alert_subscriber" ADD COLUMN "mention_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_subscriber" ADD CONSTRAINT "alert_subscriber_mention_role_ck" CHECK ("alert_subscriber"."mention_role_id" IS NULL OR "alert_subscriber"."mention_role_id" ~ '^[0-9]{17,20}$');