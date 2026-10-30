ALTER TABLE "zift_card_tokens" ADD COLUMN "account_type" text DEFAULT 'R' NOT NULL;--> statement-breakpoint
ALTER TABLE "zift_card_tokens" ADD COLUMN "noc_last_code" text;--> statement-breakpoint
ALTER TABLE "zift_card_tokens" ADD COLUMN "noc_last_applied_at" timestamp;