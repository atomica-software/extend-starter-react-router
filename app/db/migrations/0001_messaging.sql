CREATE TABLE "sms_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"from_number" text NOT NULL,
	"body" text NOT NULL,
	"keyword" text,
	"outbox_id" bigint,
	"status" text NOT NULL,
	"provider_sid" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"thread_kind" text NOT NULL,
	"thread_id" text NOT NULL,
	"contact_id" text,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"provider_sid" text,
	"error" text,
	"expects" text[],
	"reply_body" text,
	"reply_keyword" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_outbox_mode_check" CHECK ("sms_outbox"."mode" IN ('test', 'live'))
);
--> statement-breakpoint
ALTER TABLE "sms_inbox" ADD CONSTRAINT "sms_inbox_outbox_id_sms_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."sms_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_inbox_provider_sid_key" ON "sms_inbox" USING btree ("provider_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_outbox_provider_sid_key" ON "sms_outbox" USING btree ("provider_sid");--> statement-breakpoint
CREATE INDEX "sms_outbox_thread_idx" ON "sms_outbox" USING btree ("thread_kind","thread_id");--> statement-breakpoint
CREATE INDEX "sms_outbox_open_idx" ON "sms_outbox" USING btree ("to_number") WHERE "sms_outbox"."expects" IS NOT NULL AND "sms_outbox"."replied_at" IS NULL;