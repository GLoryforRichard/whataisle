CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"store_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"detail_json" jsonb,
	"is_impersonation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_map" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"map_json" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_note" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shelf" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"label_zh" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"display_name_zh" text,
	"logo_key" text,
	"opening_hours" jsonb,
	"announcement" text,
	"announcement_zh" text,
	"status" text DEFAULT 'active' NOT NULL,
	"staff_pin_hash" text,
	"pin_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "store_terms_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floor_map" ADD CONSTRAINT "floor_map_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf" ADD CONSTRAINT "shelf_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_terms_acceptance" ADD CONSTRAINT "store_terms_acceptance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_store_id_idx" ON "audit_log" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "floor_map_store_id_idx" ON "floor_map" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_store_id_code_idx" ON "shelf" USING btree ("store_id","code");--> statement-breakpoint
CREATE INDEX "shelf_store_id_idx" ON "shelf" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_handle_idx" ON "store" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "store_owner_user_id_idx" ON "store" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "store_terms_acceptance_user_id_idx" ON "store_terms_acceptance" USING btree ("user_id");