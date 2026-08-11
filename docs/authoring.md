# Writing a pack

How to get from a blank page to a published pack on a TV. The field-by-field
reference is [`pack-format.md`](./pack-format.md); this is the order to do
things in and the things that go wrong.

**Content never enters this repo.** `packs/` and `*.pack.json` are gitignored,
the repo is public, and Postgres is the only place a finished pack exists. The
pack file on your laptop is a working draft, not the deployed artefact.

---

## The short version

```
write clues as JSON  →  import as a draft  →  add images  →  publish  →  create a game
```

Steps 1 and 3 are the ones that take real time. Everything else is a command.

---

## 1. Write the clues

One JSON file, `packs/<slug>.pack.json`. Start from the shape in
[`pack-format.md`](./pack-format.md#shape).

Things that are easy to get wrong on clue 40:

- **Never write a point value.** `tier` (1–5) drives both the points
  (`tier × valueStep`) and the sips (`drinkScale[tier - 1]`). Round 2 doubles
  the points by setting `valueStep: 200`, and deliberately does not double the
  drinking.
- **Price is difficulty.** Tier 1 is a gimme, tier 5 should hurt. Getting this
  backwards is the most common authoring mistake and the dry run will expose it.
- **Don't place the Daily Doubles.** You say how many a round has; positions are
  drawn fresh per game so nobody can learn them from a previous run.
- **Write the answer as you'd accept it out loud.** The host reads it off a
  phone mid-sentence and has to judge a near-miss in about a second. `Glomma`
  beats `Glomma, som er Norges lengste elv`.
- **Leave a deliberate marker for anything you can't write yet.** Something like
  `FYLL INN: navn` shows up in that exact form on the host console, which is far
  better than a plausible-looking placeholder you forget about.

Writing 60 clues in a browser form would be miserable, which is why authoring is
a text file. The web surface exists for *editing*, not for bulk entry.

## 2. Import as a draft

```bash
curl -X POST -H "x-pin: $ADMIN_PIN" -H "Content-Type: application/json" \
  --data-binary @packs/fadderuke-2026.pack.json \
  "https://web-production-8dbfa.up.railway.app/api/admin/import?draft=1"
```

`?draft=1` saves an incomplete pack. Without it, the same request also publishes
— and publishing enforces rules a half-finished pack will fail (see
[step 5](#5-publish)).

Import is **all or nothing**. Fifty-nine good clues and one typo is a rejected
pack with the path to the bad clue, not a half-loaded one. Re-importing replaces
the pack wholesale, so iterating on the file is cheap — until a game exists
(see [fixing things later](#fixing-things-later)).

## 3. Images

### Preparing them

The board draws at a fixed 1920×1080 and *contains* the photo — it is never
cropped to fill, because these clues are usually already crops and trimming
their edges would throw away the part that makes them answerable.

- **Long edge 1200–1600 px** is plenty. Bigger is wasted bytes on venue wifi.
- **JPEG, quality ~80**, aiming under ~400 KB each. `image/png`, `image/webp`
  and `image/gif` also work; PNG is worth it only for flat graphics.
- **Crop to the detail, not the subject.** For a "zoomed in" category the crop
  *is* the question. Leave out signage, watermarks and anything with the answer
  written on it.
- **Check it at TV distance, not on a laptop.** A crop that is obvious at 40 cm
  is often unreadable across a room, and vice versa.

macOS has everything you need built in:

```bash
sips -s format jpeg -s formatOptions 80 -Z 1600 original.heic --out klar.jpg
```

### Getting them in

**Route A — one at a time through `/admin`.** Open `/admin` on your phone, enter
`ADMIN_PIN`, pick the pack, tap a clue, choose a file. Image clues with no bytes
are outlined in red in the list, so the missing ones find themselves. This is
the better route: no re-import, and it works on the day.

**Route B — base64 in the pack file.** Bulk, and the only option if you want the
file to be self-contained:

```bash
base64 -i klar.jpg | tr -d '\n' | pbcopy
```

Paste it as a **sibling** of `payload`, not inside it:

```jsonc
{
  "tier": 3,
  "answer": "Bryggen i Bergen",
  "payload": { "kind": "image", "prompt": "Hvilken bygning?" },
  "image": { "mime": "image/jpeg", "base64": "/9j/4AAQSkZJRg…" }
}
```

No `data:` prefix. Base64 inflates by a third, and the import body limit is
64 MB — enough for a couple of dozen sensibly sized photos, not for raw camera
files.

**Route C — drop files in a folder.** For a batch, this is the least typing:

```bash
cp ~/Bilder/utsnitt.jpg packs/media/kjendisoyne-1.jpg
node scripts/embed-images.mjs
```

Files are matched by `<category>-<tier>.<ext>`, using the `fromLabel` for half
of a paired category — so a painting in the paired *Musikk*/*Kunstverk*
category is `kunstverk-3.jpg`, not `musikk-3.jpg`. Run the script with no files
present and it prints every name it is waiting for. `packs/` is gitignored, so
the photos stay out of the repo.

### The whole picture on the reveal

A cropped question is better with its uncropped answer. Add a second file with
`-reveal` before the extension, or a `revealImage` sibling of `image`:

```bash
cp ~/Bilder/hele-bildet.jpg packs/media/kjendisoyne-1-reveal.jpg
```

The board swaps to it when the answer comes out and never before, so it is safe
to ship alongside the crop. Entirely optional — a clue without one reveals
exactly as it always did.

### If an image can't be found in time

Change the clue's `kind` from `image` to `text` and rewrite the prompt as a
description. The validator stops asking, and the clue still plays.

## 4. Spotify links

`audio_host` clues carry a `link` the host console renders as a tappable card —
the host phone is the music player. Use a real track link (Share → Copy Song
Link), not a search URL: at 21:30 nobody wants to pick from a results page.

`hint` is a note to the host only, never shown on the TV. Something like
`5 sekunder intro` is enough.

## 5. Publish

Either re-import without `?draft=1`, or — if the images came in through
`/admin` — press **Publiser pakken** there. Both run the same rules against
what is actually in the database:

| Rejection | What it means |
|---|---|
| `image-clue mangler bilde` | An `image` clue has no bytes. Upload one, or change the kind to `text`. |
| `bilde er lagt ved en text-clue` | An image is attached to a non-image clue. Almost always the `kind` is wrong. |
| `paret kategori krever fromLabel på hver clue` | The category sets `pairedWith`, so every clue needs a `fromLabel`. |
| `to klør i samme kategori har samme tier` | Two clues at the same price in one category. |
| `spillbar runde må ha valueStep` | 100 in round 1, 200 in round 2. Only the Final may omit it. |
| `final må ha nøyaktig én clue` | The Final is one round, one category, one clue, zero Daily Doubles. |
| `N daily doubles i en runde med M ruter` | More Daily Doubles than tiles to hide them in. |

Unknown keys are rejected rather than ignored — a misspelled field is a clue
that renders blank in front of the room.

A pack must be published before a game can be created from it.

## 6. Create the game

```bash
curl -X POST -H "x-pin: $HOST_PIN" -H "Content-Type: application/json" \
  -d '{"packSlug":"fadderuke-2026","code":"NTNU"}' \
  "https://web-production-8dbfa.up.railway.app/api/host/games"
```

Omit `code` and a safe one is generated (no vowels, no `0`/`O`/`1`/`I`). The
board is then `/?code=NTNU`, and teams join at `/t?code=NTNU` — which is what
the lobby QR encodes.

Playing a pack does not consume it. Clue state lives in `game_clues`, one row
per game, so the same pack can be played again with every tile closed and the
Daily Doubles somewhere new.

---

## Fixing things later

**Once any game exists on a pack, import refuses to replace it.**

```
Pakken "fadderuke-2026" er allerede i bruk av et spill. Bruk clue-editoren.
```

That is deliberate: games reference the pack, and their score history would stop
making sense underneath them. It leaves you two routes, and they do not mix.

| | When | Cost |
|---|---|---|
| **Edit in `/admin`** | A handful of fixes, or you're mid-event | Fast. **The pack file is now stale** — re-importing it later silently reverts every fix. |
| **Re-import the file** | A long list of fixes | Delete every game on that pack first (`/admin` → Spill → Slett, typing the room code). The file stays the source of truth. |

Pick one deliberately. The failure mode is editing in `/admin` for a week, then
re-importing the file for one unrelated change and losing all of it.

The `/admin` editor can change a clue's prompt, answer, kind, `fromLabel`,
Spotify link and hint, and can attach, replace or remove its image.

---

## Reference

All admin routes take `x-pin: $ADMIN_PIN`.

| Route | Does |
|---|---|
| `POST /api/admin/import[?draft=1]` | Import a whole pack |
| `GET /api/admin/packs` | List packs and their published state |
| `GET /api/admin/packs/:slug` | The whole pack as a tree, answers included |
| `POST /api/admin/packs/:slug/publish` | Validate and publish what is in the database |
| `PATCH /api/admin/clues/:id` | Edit one clue |
| `PUT /api/admin/clues/:id/image` | Attach or replace an image (`{mime, base64}`) |
| `DELETE /api/admin/clues/:id/image` | Remove an image |
| `PUT /api/admin/clues/:id/reveal` | Attach or replace the reveal picture (`{mime, base64}`) |
| `DELETE /api/admin/clues/:id/reveal` | Remove the reveal picture |
| `GET /api/admin/games` | Every game, and which pack it locks |
| `DELETE /api/admin/games/:code` | Delete a game (body: `{"confirm":"CODE"}`) |

---

## Later: authoring in the browser

The PRD parks a full browser authoring UI until after the event (§6.2), and
this document is what it would have to replace. If it gets built, the pieces
already in place are the tree endpoint, the per-clue `PATCH`, image upload and
publish — what's missing is creating and reordering rounds, categories and
clues, which is exactly the part a JSON file is currently better at.

Worth keeping either way: a text file diffs, a browser form does not.
