CREATE TABLE "zift_card_tokens" (
	"saleor_transaction_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"account_accessory" text,
	"brand" text,
	"last_four" text,
	"holder_name" text,
	"saleor_checkout_id" text,
	"saleor_order_id" text,
	"saleor_customer_id" text,
	"verification_reference" text,
	"status" text DEFAULT 'established' NOT NULL,
	"last_charge_reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zift_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
