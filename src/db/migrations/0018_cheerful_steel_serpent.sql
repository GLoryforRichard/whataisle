CREATE TABLE "background_job" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "impersonation_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"store_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"store_count" integer DEFAULT 1 NOT NULL,
	"preferred_language" text NOT NULL,
	"message" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"marketing_consent_at" timestamp,
	"reporter_hash" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"accepted_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store" ALTER COLUMN "status" SET DEFAULT 'onboarding';--> statement-breakpoint
ALTER TABLE "background_job" ADD CONSTRAINT "background_job_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_grant" ADD CONSTRAINT "impersonation_grant_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_grant" ADD CONSTRAINT "impersonation_grant_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invite" ADD CONSTRAINT "store_invite_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invite" ADD CONSTRAINT "store_invite_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_job_idempotency_idx" ON "background_job" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "background_job_run_idx" ON "background_job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "background_job_store_idx" ON "background_job" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "impersonation_grant_token_idx" ON "impersonation_grant" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "impersonation_grant_expiry_idx" ON "impersonation_grant" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sales_lead_status_created_idx" ON "sales_lead" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sales_lead_email_idx" ON "sales_lead" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "store_invite_token_hash_idx" ON "store_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "store_invite_email_status_idx" ON "store_invite" USING btree ("email","status");