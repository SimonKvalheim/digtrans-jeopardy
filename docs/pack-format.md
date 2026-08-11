# Clue pack format

The wire format for `POST /api/admin/import`, defined by
[`src/shared/pack-schema.ts`](../src/shared/pack-schema.ts). Packs are authored as JSON, **never
committed** (`.gitignore` blocks `*.pack.json` and `clues*.json`), and pushed over HTTPS behind
`ADMIN_PIN`. Postgres is the only place a pack exists afterwards.

This is the reference. For the order to do things in — drafting, images, publishing, and fixing a
clue after the fact — see [`authoring.md`](./authoring.md).

Import is two-phase, which is what lets clue text be drafted before images exist. `?draft=1` selects
the first; without it, a successful import also publishes:

| Phase | Enforces | Fails when |
|---|---|---|
| **Draft** | `packSchema` — structure, types, unknown keys | a field is misspelled, a tier repeats within a category |
| **Publish** | `validateForPublish` — everything a live board needs | an `image` clue has no bytes, a paired category is missing `fromLabel` |

Unknown keys are **rejected, not ignored**. A typo'd field is a clue that renders blank on a TV in
front of thirty people.

## Shape

```jsonc
{
  "slug": "fadderuke-2026",          // lowercase, digits, hyphens
  "title": "Fadderuke 2026",
  "locale": "nb",
  "drinkScale": [2, 4, 6, 8, 10],    // sips per tier, indexed by tier - 1
  "rounds": [
    {
      "kind": "jeopardy",            // jeopardy | double | final
      "valueStep": 100,              // clue value = tier × valueStep
      "dailyDoubles": 1,             // positions are drawn per game, not here
      "categories": [
        {
          "name": "Emoji-oversettelse",
          "clues": [
            { "tier": 1, "answer": "Løvenes konge", "payload": { "kind": "emoji", "prompt": "🦁👑" } },
            { "tier": 2, "answer": "Titanic",       "payload": { "kind": "text",  "prompt": "Hvilken film …" } }
          ]
        }
      ]
    }
  ]
}
```

## Rules worth knowing before you write 60 clues

- **Never write a point value.** `tier` (1–5) drives both the points (`tier × valueStep`) and the
  sips (`drinkScale[tier - 1]`), so the same pack works in either round.
- **Tiers must be unique within a category**, and there are at most 5.
- **Price is difficulty.** Tier 1 is a gimme; tier 5 should hurt.
- **Categories:** 1–8 per round. The round-2 fallback in the PRD ("cut to 4 categories") is a data
  change with no code change, and this is why.
- **Final** is one round with exactly one category, one clue, and `dailyDoubles: 0`. It is scored
  purely on the wager, so `valueStep` may be omitted there — but every playable round must set it.

## Clue kinds

Kinds are a plugin registry ([`clue-kinds.ts`](../src/shared/clue-kinds.ts)). The payload carries its
own `kind`, and the `clues.kind` column is derived from it on import so the two cannot drift.

| `kind` | Payload fields | Notes |
|---|---|---|
| `text` | `prompt` | The default. |
| `emoji` | `prompt` (≤ 40 chars) | Rendered enormous; a long string defeats the point. |
| `image` | `prompt` | Requires a sibling `image` object to publish. |
| `audio_host` | `prompt`, `link`, `hint` | Host phone plays it — `link` renders as a tappable card. |
| `audio_file` | `prompt` | Declared, not wired up. Not event work. |
| `video` | `prompt`, `start?` | Declared, not wired up. Not event work. |

### Paired categories

When a category sets `pairedWith`, **every** clue in it needs a `fromLabel` saying which half it came
from. Publish rejects the pack otherwise.

```jsonc
{
  "name": "Musikk",
  "pairedWith": "Kunstverk",
  "clues": [
    { "tier": 1, "answer": "Mona Lisa", "fromLabel": "Kunstverk", "payload": { "kind": "text", "prompt": "…" } }
  ]
}
```

### Images

Raw base64, no `data:` prefix, alongside the clue rather than inside the payload. The bytes land in
`clue_media`, so there are no asset files to lose. `image/jpeg`, `image/png`, `image/webp` and
`image/gif` are accepted; sizing and cropping advice is in
[`authoring.md`](./authoring.md#3-images), along with the route that uploads one image at a time
without re-importing the pack.

```jsonc
{
  "tier": 3,
  "answer": "Bryggen i Bergen",
  "payload": { "kind": "image", "prompt": "Hvilken bygning?" },
  "image": { "mime": "image/jpeg", "base64": "/9j/4AAQSkZJRg…" }
}
```

Attaching an `image` to a non-`image` clue is an error, not a no-op — it almost always means the
`kind` is wrong.
