ALTER TABLE "alert_subscriber" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_subscriber" ADD COLUMN "channel" text DEFAULT 'imessage' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_subscriber" ADD COLUMN "webhook_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_subscriber_webhook_idx" ON "alert_subscriber" USING btree ("webhook_url");--> statement-breakpoint
ALTER TABLE "alert_subscriber" ADD CONSTRAINT "alert_subscriber_address_ck" CHECK (("alert_subscriber"."channel" = 'imessage' AND "alert_subscriber"."phone" IS NOT NULL)
       OR ("alert_subscriber"."channel" = 'discord' AND "alert_subscriber"."webhook_url" IS NOT NULL));