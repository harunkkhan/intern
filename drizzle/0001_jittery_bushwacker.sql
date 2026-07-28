CREATE TABLE "allowed_email" (
	"email" text PRIMARY KEY NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
