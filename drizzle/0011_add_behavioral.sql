CREATE TABLE "behavioral_question" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"section_id" text NOT NULL,
	"prompt" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "behavioral_section" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "behavioral_question" ADD CONSTRAINT "behavioral_question_section_id_behavioral_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."behavioral_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "behavioral_question_section_prompt_idx" ON "behavioral_question" USING btree ("section_id","prompt");--> statement-breakpoint
CREATE INDEX "behavioral_question_section_idx" ON "behavioral_question" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "behavioral_section_user_name_idx" ON "behavioral_section" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "behavioral_section_user_idx" ON "behavioral_section" USING btree ("user_id");