CREATE TYPE "public"."clue_phase" AS ENUM('closed', 'dd_wager', 'dd_answer', 'clue_open', 'steal_open', 'steal_answer', 'revealed', 'done');--> statement-breakpoint
CREATE TYPE "public"."round_kind" AS ENUM('jeopardy', 'double', 'final');--> statement-breakpoint
CREATE TABLE "buzzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gameClueId" uuid NOT NULL,
	"teamId" uuid NOT NULL,
	"receivedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"pressOffsetMs" integer,
	"won" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roundId" uuid NOT NULL,
	"name" text NOT NULL,
	"pairedWith" text,
	"position" integer NOT NULL,
	CONSTRAINT "categories_roundId_position_unique" UNIQUE("roundId","position")
);
--> statement-breakpoint
CREATE TABLE "clue_media" (
	"clueId" uuid PRIMARY KEY NOT NULL,
	"imageBytes" "bytea",
	"imageMime" text,
	"ttsBytes" "bytea",
	"ttsVoiceId" text,
	"ttsBuiltAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"categoryId" uuid NOT NULL,
	"tier" integer NOT NULL,
	"answer" text NOT NULL,
	"fromLabel" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "clues_categoryId_tier_unique" UNIQUE("categoryId","tier")
);
--> statement-breakpoint
CREATE TABLE "final_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gameId" uuid NOT NULL,
	"teamId" uuid NOT NULL,
	"wager" integer NOT NULL,
	"answer" text,
	"verdict" text,
	"lockedAt" timestamp with time zone,
	CONSTRAINT "final_bets_gameId_teamId_unique" UNIQUE("gameId","teamId")
);
--> statement-breakpoint
CREATE TABLE "game_clues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gameId" uuid NOT NULL,
	"clueId" uuid NOT NULL,
	"phase" "clue_phase" DEFAULT 'closed' NOT NULL,
	"ownerTeamId" uuid,
	"isDailyDouble" boolean DEFAULT false NOT NULL,
	"wager" integer,
	CONSTRAINT "game_clues_gameId_clueId_unique" UNIQUE("gameId","clueId")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"packId" uuid NOT NULL,
	"code" text NOT NULL,
	"phase" text DEFAULT 'lobby' NOT NULL,
	"activeRoundId" uuid,
	"activeClueId" uuid,
	"turnTeamId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"locale" text DEFAULT 'nb' NOT NULL,
	"drinkScale" jsonb NOT NULL,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"packId" uuid NOT NULL,
	"kind" "round_kind" NOT NULL,
	"position" integer NOT NULL,
	"valueStep" integer NOT NULL,
	"dailyDoubles" integer NOT NULL,
	CONSTRAINT "rounds_packId_position_unique" UNIQUE("packId","position")
);
--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gameId" uuid NOT NULL,
	"teamId" uuid NOT NULL,
	"clueId" uuid,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"note" text,
	"undone" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gameId" uuid NOT NULL,
	"name" text NOT NULL,
	"pitch" text,
	"score" integer DEFAULT 0 NOT NULL,
	"joinToken" text NOT NULL,
	"seat" integer NOT NULL,
	CONSTRAINT "teams_joinToken_unique" UNIQUE("joinToken"),
	CONSTRAINT "teams_gameId_seat_unique" UNIQUE("gameId","seat")
);
--> statement-breakpoint
ALTER TABLE "buzzes" ADD CONSTRAINT "buzzes_gameClueId_game_clues_id_fk" FOREIGN KEY ("gameClueId") REFERENCES "public"."game_clues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buzzes" ADD CONSTRAINT "buzzes_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_roundId_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clue_media" ADD CONSTRAINT "clue_media_clueId_clues_id_fk" FOREIGN KEY ("clueId") REFERENCES "public"."clues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clues" ADD CONSTRAINT "clues_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_bets" ADD CONSTRAINT "final_bets_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_bets" ADD CONSTRAINT "final_bets_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_clues" ADD CONSTRAINT "game_clues_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_clues" ADD CONSTRAINT "game_clues_clueId_clues_id_fk" FOREIGN KEY ("clueId") REFERENCES "public"."clues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_packId_packs_id_fk" FOREIGN KEY ("packId") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_packId_packs_id_fk" FOREIGN KEY ("packId") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buzzes_gameClueId_receivedAt_index" ON "buzzes" USING btree ("gameClueId","receivedAt");--> statement-breakpoint
CREATE INDEX "score_events_gameId_createdAt_index" ON "score_events" USING btree ("gameId","createdAt");