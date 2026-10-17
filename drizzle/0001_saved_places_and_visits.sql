CREATE TABLE "saved_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"place_id" text NOT NULL,
	"place" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_places_device_id_place_id_unique" UNIQUE("device_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"place_id" text NOT NULL,
	"place" jsonb NOT NULL,
	"mode" text NOT NULL,
	"lines" text[] DEFAULT '{}' NOT NULL,
	"rating" smallint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "visits_device_id_place_id_unique" UNIQUE("device_id","place_id")
);
--> statement-breakpoint
CREATE INDEX "visits_place_id_index" ON "visits" USING btree ("place_id");