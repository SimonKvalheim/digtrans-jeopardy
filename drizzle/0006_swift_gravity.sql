CREATE TABLE "show_media" (
	"name" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"mime" text DEFAULT 'audio/mpeg' NOT NULL,
	"gain" real DEFAULT 1 NOT NULL,
	"prompt" text,
	"durationMs" integer,
	"generatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
