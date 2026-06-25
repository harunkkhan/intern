CREATE TABLE "application_event" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"email_subject" text,
	"email_from" text,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_event_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company" text NOT NULL,
	"position" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"term" text,
	"industry" text,
	"company_type" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"location" text,
	"notes" text,
	"source" text,
	"applied_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_token" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_message" (
	"user_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"is_application" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_message_user_id_gmail_message_id_pk" PRIMARY KEY("user_id","gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"last_result_count" integer,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_application_idx" ON "application_event" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_user_dedupe_idx" ON "application" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "application_user_idx" ON "application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "processed_user_idx" ON "processed_message" USING btree ("user_id");