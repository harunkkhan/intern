CREATE TABLE "alert_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"phone" text NOT NULL,
	"scope" text DEFAULT 'watchlist' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_listing" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"company" text NOT NULL,
	"normalized_company" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"locations" jsonb,
	"term" text,
	"sponsorship" text,
	"category" text,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_source" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"adapter" text NOT NULL,
	"config" jsonb NOT NULL,
	"trusted_intern_only" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sha" text,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"found" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"notified" integer DEFAULT 0 NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "watched_company" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"source_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_subscriber_id_alert_subscriber_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."alert_subscriber"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_listing_id_job_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."job_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_listing" ADD CONSTRAINT "job_listing_source_id_job_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_run" ADD CONSTRAINT "poll_run_source_id_job_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_company" ADD CONSTRAINT "watched_company_source_id_job_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_delivery_subscriber_dedupe_idx" ON "alert_delivery" USING btree ("subscriber_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alert_delivery_status_idx" ON "alert_delivery" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_subscriber_phone_idx" ON "alert_subscriber" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "alert_subscriber_user_idx" ON "alert_subscriber" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_listing_source_external_idx" ON "job_listing" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "job_listing_company_idx" ON "job_listing" USING btree ("normalized_company");--> statement-breakpoint
CREATE INDEX "job_listing_first_seen_idx" ON "job_listing" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "job_listing_dedupe_idx" ON "job_listing" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_source_label_adapter_idx" ON "job_source" USING btree ("label","adapter");--> statement-breakpoint
CREATE INDEX "job_source_enabled_idx" ON "job_source" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "poll_run_source_idx" ON "poll_run" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_company_user_name_idx" ON "watched_company" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "watched_company_user_idx" ON "watched_company" USING btree ("user_id");