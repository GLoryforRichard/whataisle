CREATE TABLE "mapping_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"type" text DEFAULT 'initial' NOT NULL,
	"video_id" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"note" text,
	"due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_video" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"chunks_received" jsonb,
	"total_chunks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mapping_ticket" ADD CONSTRAINT "mapping_ticket_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_video" ADD CONSTRAINT "store_video_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mapping_ticket_status_idx" ON "mapping_ticket" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mapping_ticket_store_id_idx" ON "mapping_ticket" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_video_store_id_idx" ON "store_video" USING btree ("store_id");