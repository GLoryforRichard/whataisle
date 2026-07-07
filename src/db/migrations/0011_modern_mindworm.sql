CREATE TABLE "ai_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ref_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_report" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text,
	"reporter_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "miss_insight" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"query_text" text NOT NULL,
	"hitless_count" integer DEFAULT 1 NOT NULL,
	"classification" text DEFAULT 'unclassified' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_searched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"canonical_name" text NOT NULL,
	"name_zh" text,
	"category" text,
	"search_text" text DEFAULT '' NOT NULL,
	"embedding" vector(768),
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"confidence_state" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text NOT NULL,
	"alias" text NOT NULL,
	"lang" text NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_location" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text NOT NULL,
	"shelf_id" text NOT NULL,
	"side" text,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_task" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scan_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"shelf_id" text NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"shelf_id" text NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"faces_blurred" boolean DEFAULT false NOT NULL,
	"detected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "search_log" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"query_text" text NOT NULL,
	"query_lang" text,
	"input_method" text NOT NULL,
	"answer_tone" text,
	"result_count" integer DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"is_deflected" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_report" ADD CONSTRAINT "feedback_report_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_report" ADD CONSTRAINT "feedback_report_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "miss_insight" ADD CONSTRAINT "miss_insight_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_shelf_id_shelf_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_batch" ADD CONSTRAINT "scan_batch_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_batch" ADD CONSTRAINT "scan_batch_shelf_id_shelf_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_photo" ADD CONSTRAINT "scan_photo_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_photo" ADD CONSTRAINT "scan_photo_batch_id_scan_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."scan_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_photo" ADD CONSTRAINT "scan_photo_shelf_id_shelf_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_log" ADD CONSTRAINT "search_log_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_log_store_id_idx" ON "ai_usage_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_report_unique_idx" ON "feedback_report" USING btree ("product_id","reporter_hash");--> statement-breakpoint
CREATE INDEX "feedback_report_store_id_idx" ON "feedback_report" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "miss_insight_store_query_idx" ON "miss_insight" USING btree ("store_id","query_text");--> statement-breakpoint
CREATE UNIQUE INDEX "product_store_id_canonical_idx" ON "product" USING btree ("store_id","canonical_name");--> statement-breakpoint
CREATE INDEX "product_store_id_status_idx" ON "product" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "product_alias_store_id_alias_idx" ON "product_alias" USING btree ("store_id","alias");--> statement-breakpoint
CREATE INDEX "product_alias_product_id_idx" ON "product_alias" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_location_unique_idx" ON "product_location" USING btree ("product_id","shelf_id","side");--> statement-breakpoint
CREATE INDEX "product_location_store_id_idx" ON "product_location" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "product_location_shelf_id_idx" ON "product_location" USING btree ("shelf_id");--> statement-breakpoint
CREATE INDEX "review_task_store_id_status_idx" ON "review_task" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "scan_batch_store_id_idx" ON "scan_batch" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "scan_photo_batch_id_idx" ON "scan_photo" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "scan_photo_store_id_idx" ON "scan_photo" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "search_log_store_id_created_idx" ON "search_log" USING btree ("store_id","created_at");