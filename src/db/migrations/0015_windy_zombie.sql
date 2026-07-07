CREATE TABLE "weekly_report" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"week_start" text NOT NULL,
	"stats_json" jsonb,
	"emailed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_report" ADD CONSTRAINT "weekly_report_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_unique_idx" ON "weekly_report" USING btree ("store_id","week_start");