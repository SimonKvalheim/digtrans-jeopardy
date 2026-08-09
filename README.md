# digtrans-jeopardy

A self-hosted Jeopardy game built for a student party: **board on a TV, hosted from a phone, one phone per
team.** Two rounds plus Final Jeopardy, Daily Doubles, a buzzer race, and an AI host that reads the clues
aloud.

Built for one night in August 2026, but deliberately not single-use — content is organised into reusable
**packs**, so a second event is new content rather than a fork.

## How it runs

| Surface | Route | Device |
|---|---|---|
| Board | `/` | Laptop plugged into a TV. Open it, fullscreen, walk away. |
| Host console | `/host` | The host's phone. PIN-gated. |
| Team | `/t` | One phone per team. |
| Content admin | `/admin` | Import and edit clue packs. PIN-gated. |

One Node process serves the SPA and the WebSocket on the same origin; state lives in Postgres so a redeploy
mid-game costs nothing.

## Stack

Node 22 · Express · `ws` · Vite · React · TypeScript · Drizzle ORM · PostgreSQL · Railway
· OpenRouter (team-name judging) · ElevenLabs (host voice)

## Getting started

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL, HOST_PIN, ADMIN_PIN, API keys
npm run db:migrate
npm run dev
```

Clue content is **not** in this repo — it is imported at runtime through `/admin`. See
[`docs/PRD.md`](docs/PRD.md) for the pack format.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — the full spec: rules, data model, architecture, decision log
- `docs/prd.html` — the same document rendered with mockups and diagrams

## Licence

MIT (code only). No clue content, images, or audio are distributed with this repository.
