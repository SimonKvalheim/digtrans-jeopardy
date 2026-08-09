# digtrans-jeopardy — build instructions

A hosted Jeopardy game for a fadderuke vorspiel. **The event is Tuesday 11 August 2026.** Everything below
serves that date.

**Read [`docs/PRD.md`](docs/PRD.md) first — it is the complete, closed spec.** `docs/prd.html` is the same
document rendered with mockups and diagrams (open in a browser; it needs no server).
`docs/_private/transcript.md` is the source conversation the spec came from — gitignored, never commit it.

## The shape in one paragraph

One Node process on Railway serves a Vite/React SPA and a WebSocket on the same origin, backed by Railway
Postgres via Drizzle. Three surfaces: `/` is the board on a borrowed laptop plugged into a TV (zero
interaction), `/host` is the console on Simon's own phone (everything), `/t` is one phone per team (join,
buzz, wager). `/admin` imports clue packs. Two rounds of 6×5 plus Final Jeopardy, five teams of six.

## Non-negotiables

These are the ones that decide whether Tuesday works. Do not trade them away for features.

1. **The host console works alone.** Manual team creation, arbitrary score adjustment, declare-a-steal, undo.
   Phones are an *optional input layer* over a console that can run the whole game by itself. This is what
   makes a dead venue network survivable — it is core scope, not a fallback mode.
2. **Reconnect must survive a locked phone.** `joinToken` in `localStorage` restores the same team. Without
   it the game dies twenty minutes in.
3. **Nothing on the critical path calls a third-party API at play time.** TTS is pre-generated at publish.
   Name judging is one call at the intro and degrades to manual. If OpenRouter or ElevenLabs is down at
   21:30, the game is unaffected.
4. **Content never enters git.** Questions, answers, images and audio live only in Postgres, imported
   through PIN-gated `/admin`. The repo is public.
5. **The game must be playable from Sunday night** — board renders + host scores manually — before phones,
   voice, or effects exist. Protect that property when sequencing work.

## Architecture rules

- **`packs` (content) and `games` (one night of play) are separate tables.** Per-night mutation lives in
  `game_clues`. A clue row must never carry "has this been answered".
- **Clue types are a plugin registry**, not a switch statement. A new kind is a `CluePayload` variant, a
  board renderer, an optional host control, and a Zod schema. No core changes.
- **`clues.tier` (1–5) drives both points and sips** — `tier × round.valueStep` and `pack.drinkScale[tier]`.
  Never store a raw point value on a clue; the same pack has to work in either round.
- **`score_events` is append-only.** `teams.score` is a fast read derived from it. This is what makes undo
  free — and undo will be used.
- **Buzz ranking is server-authoritative.** Timestamp on arrival, lock on the same tick so a double-award is
  structurally impossible. Never trust a client clock. `pressOffsetMs` exists for the clock-offset upgrade
  if the dry run shows it's needed — see PRD §5.1.
- **Team names are untrusted input** and go into an LLM prompt. The model returns a *ranking of given team
  IDs*; the server maps it onto fixed 300/200/100 tiers. The model can never set a score.

## Railway

- Bind `0.0.0.0` and `process.env.PORT`. Hardcoding a port fails the health check.
- App uses the private `DATABASE_URL`; `DATABASE_PUBLIC_URL` is for migrations from a laptop only.
- **Turn off App Sleeping** — a cold start on the first buzz of the night would be very bad.
- Reconnect the WebSocket with backoff; a redeploy drops every socket.
- Env: `HOST_PIN`, `ADMIN_PIN`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`. Never committed.

## Conventions

- TypeScript everywhere. Plain CSS with custom properties on the board — the Jeopardy blue-and-gold is
  specific and it's faster to write it directly than to fight a utility framework.
- **UI copy is Norwegian (bokmål).** Code, comments and commits are English.
- Deliberately boring dependencies. Two days is not the time to learn something new.
- No test suite beyond a scoring-logic unit test. Scoring is the one place a silent bug ruins the evening.

## Do not

- Do not commit clue content, images, generated audio, or the Jeopardy theme (still in copyright).
- Do not add auth beyond the two PINs, multi-tenancy, or a full browser authoring UI before the event.
- Do not make the board responsive. It is a TV.
- Do not let the app track or total drinks. It *displays* buy-in and payout; people sort themselves out.
