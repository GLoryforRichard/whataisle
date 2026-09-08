CREATE TABLE "store_owner_entry" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"pin_version" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "store_runtime" (
	"store_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"kind" text DEFAULT 'provision' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_hash" text,
	"lease_expires_at" timestamp,
	"worker_id" text,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"port" integer,
	"runtime_token_hash" text,
	"runtime_version" text,
	"ready_at" timestamp,
	"cleanup_requested_at" timestamp,
	"cleanup_requested_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_billing_event" (
	"id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_billing_notice" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"grace_ends_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_checkout" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"plan" text NOT NULL,
	"currency" text NOT NULL,
	"is_test" boolean NOT NULL,
	"gift_eligible" boolean NOT NULL,
	"price_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"session_id" text,
	"session_url" text,
	"stripe_subscription_id" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "store_subscription" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"store_id" text,
	"currency" text NOT NULL,
	"plan" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_schedule_id" text,
	"gift_used_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"entitlement_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"retention_until" timestamp with time zone,
	"cancel_at_end" boolean DEFAULT false NOT NULL,
	"pending_plan" text,
	"last_paid_invoice_id" text,
	"last_paid_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_owner_entry" ADD CONSTRAINT "store_owner_entry_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_runtime" ADD CONSTRAINT "store_runtime_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_subscription" ADD CONSTRAINT "store_subscription_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_runtime_job_idx" ON "store_runtime" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "store_runtime_ready_idx" ON "store_runtime" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_runtime_port_idx" ON "store_runtime" USING btree ("port");--> statement-breakpoint
CREATE UNIQUE INDEX "store_checkout_session_idx" ON "store_checkout" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "store_checkout_owner_idx" ON "store_checkout" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "store_checkout_test_idx" ON "store_checkout" USING btree ("is_test","status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscription_store_idx" ON "store_subscription" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscription_stripe_idx" ON "store_subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "store_subscription_lifecycle_idx" ON "store_subscription" USING btree ("status","grace_ends_at");