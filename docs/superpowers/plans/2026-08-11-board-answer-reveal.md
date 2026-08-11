# Board Answer Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a clue finishes, the TV shows the correct answer in gold with the question demoted to a small band above it, so the room can read the answer instead of listening to the host say it.

**Architecture:** The clue state machine already has two terminal phases (`done`, `revealed`) and already keeps the tile on screen through both. Nothing in the game loop changes. The server starts including `clues.answer` in the board payload — but *only* when the clue is terminal, because `/api/board/:code` is unauthenticated and an answer that arrives early is an answer a team can `curl` mid-clue. `ClueView` renders one shared answer block; the question demotes by passing `FitText` a smaller size range.

**Tech Stack:** TypeScript, React 19, Express 5, Drizzle + Postgres, plain CSS with custom properties. Vite build, `tsc --noEmit` typecheck.

**Spec:** [`docs/superpowers/specs/2026-08-11-board-answer-reveal-design.md`](../specs/2026-08-11-board-answer-reveal-design.md)

---

## A note on testing before you start

`CLAUDE.md` for this project says: *"No test suite beyond a scoring-logic unit test. Scoring is the one place a silent bug ruins the evening."* That instruction takes priority over the default TDD workflow. **Do not add test files in this plan.** The only existing test is `src/shared/scoring.test.ts` and it stays the only one.

The verification gate for every task is instead:

```bash
pnpm typecheck
```

and, at the end, driving the deployed app's own API (Task 6). There is no local runtime for this project — do not try to `pnpm dev` your way to confidence.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `src/shared/clue-kinds.ts` | Modify | Owns the single definition of "which clue phases are terminal" — now depended on by both the server (answer gating, tile greying) and the client (image reveal, answer reveal). |
| `src/shared/board-state.ts` | Modify | The board payload contract. Gains `activeClue.answer`, documented as server-gated. |
| `src/server/game/state.ts` | Modify | Assembles the payload. Drops its private `SPENT_PHASES` copy, selects `clues.answer`, gates it on the phase. |
| `src/client/clue-kinds.tsx` | Modify | Re-exports `isAnswerOut` from shared, adds `isRevealing(clue)`, and demotes each kind's question when the answer is out. |
| `src/client/board/ClueView.tsx` | Modify | Adds the `clue--revealed` modifier and the one shared answer block. |
| `src/client/styles.css` | Modify | Styling for `.clue__answer`, the demoted `.clue__prompt` band, and the image-clue override. |

Six files, all existing. No new modules — the reveal is a property of the clue card, not a component of its own, and splitting it out would put its two halves (the demoted question, the answer) in different files.

---

## Task 1: One definition of "the answer is out"

`isAnswerOut` currently lives in the client and the server keeps its own copy of the same set under a different name (`SPENT_PHASES`). Two copies is tolerable while it only decides which tiles are greyed; it is not tolerable once one of them decides whether an answer leaks. Move it to `shared/` first, so Task 2 has something correct to import.

**Files:**
- Modify: `src/shared/clue-kinds.ts` (append at end of file)
- Modify: `src/client/clue-kinds.tsx:37-44`
- Modify: `src/server/game/state.ts:13-14` and `src/server/game/state.ts:120`

- [ ] **Step 1: Add the predicate to shared**

Append to the end of `src/shared/clue-kinds.ts`:

```ts
/**
 * Phases in which the answer is already public to the room: `revealed` is
 * nobody getting it, `done` is somebody getting it. The tile stays on screen
 * through both until the host closes it.
 *
 * This lives in shared rather than in the client because the server uses it to
 * decide whether the answer may enter the board payload at all. Two copies of
 * "which phases are terminal" would be a copy that can drift into a leak.
 */
export const ANSWER_OUT_PHASES = ['revealed', 'done'] as const

export function isAnswerOut(phase: string): boolean {
  return (ANSWER_OUT_PHASES as readonly string[]).includes(phase)
}
```

- [ ] **Step 2: Re-export it from the client registry**

In `src/client/clue-kinds.tsx`, add `isAnswerOut` to the existing import from shared and delete the local definition.

Change the import at the top of the file from:

```tsx
import type { ClueKind } from '@shared/clue-kinds.ts'
```

to:

```tsx
import { isAnswerOut, type ClueKind } from '@shared/clue-kinds.ts'
```

Then delete this whole block (currently lines 37-44):

```tsx
/**
 * Phases in which the answer is already public: `revealed` is nobody getting
 * it, `done` is somebody getting it. The tile stays on screen through both
 * until the host closes it, and the room wants the full picture in either.
 */
export function isAnswerOut(phase: string): boolean {
  return phase === 'revealed' || phase === 'done'
}
```

and replace it with a re-export, so any existing importer of `../clue-kinds.tsx` keeps working:

```tsx
// Re-exported: the definition moved to shared once the server needed it too.
export { isAnswerOut }
```

- [ ] **Step 3: Use it on the server, deleting the duplicate**

In `src/server/game/state.ts`, delete these two lines (currently 13-14):

```ts
/** A tile is spent once its clue has been resolved one way or another. */
const SPENT_PHASES = new Set(['revealed', 'done'])
```

Add the import alongside the existing shared imports near the top of the file:

```ts
import { isAnswerOut } from '../../shared/clue-kinds.ts'
```

Then change the tile assembly (currently line 120) from:

```ts
          spent: SPENT_PHASES.has(row.phase),
```

to:

```ts
          // A tile is spent once its clue has been resolved one way or another
          // — the same condition that makes its answer public.
          spent: isAnswerOut(row.phase),
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm typecheck`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/clue-kinds.ts src/client/clue-kinds.tsx src/server/game/state.ts
git commit -m "refactor: one definition of which clue phases are terminal

The server kept its own copy as SPENT_PHASES. Fine while it only greyed
tiles; not fine now that the same condition decides whether an answer may
enter the board payload."
```

---

## Task 2: Send the answer, but only once it is public

**Files:**
- Modify: `src/shared/board-state.ts:105` (inside the `activeClue` object type)
- Modify: `src/server/game/state.ts` — `buildActiveClue`, the select list and the return object

- [ ] **Step 1: Add the field to the payload contract**

In `src/shared/board-state.ts`, inside the `activeClue` object type, add this immediately after the `stealWinner` field:

```ts
    /**
     * The correct answer — but only once the clue is terminal (`revealed` or
     * `done`). Null in every other phase, and decided on the server rather
     * than merely hidden by the board: /api/board/:code is unauthenticated by
     * design, so an answer that reaches this payload early is an answer a team
     * can curl while they are still supposed to be guessing.
     */
    answer: string | null
```

- [ ] **Step 2: Select and gate it**

In `src/server/game/state.ts`, in `buildActiveClue`'s select list, add `answer` next to the other `schema.clues` columns:

```ts
      tier: schema.clues.tier,
      kind: schema.clues.kind,
      answer: schema.clues.answer,
      payload: schema.clues.payload,
```

Then in the same function's return object, add the gated field after `stealWinner`:

```ts
    stealWinner: await buildStealWinner(row.id, row.stealTeamId),
    // The gate, not the board's job. A clue in `steal_open` is a clue a team is
    // still allowed to answer, and this endpoint needs no PIN.
    answer: isAnswerOut(row.phase) ? row.answer : null,
```

- [ ] **Step 3: Verify the contract compiles**

Run: `pnpm typecheck`
Expected: no output, exit 0. (`BoardClue` in `client/clue-kinds.tsx` derives from `BoardState['activeClue']`, so the new field flows to the board automatically.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/board-state.ts src/server/game/state.ts
git commit -m "feat: put the answer in the board payload once the clue is over

Gated server-side. /api/board/:code takes no PIN, so an answer that
arrives during clue_open or steal_open is one a team can curl."
```

---

## Task 3: Draw the answer on the TV

**Files:**
- Modify: `src/client/board/ClueView.tsx:85` (add the helper import), `:91-98` (root className), and after `:118` (`<KindBoard />`)
- Modify: `src/client/clue-kinds.tsx` (add `isRevealing`)

- [ ] **Step 1: Add the shared predicate the card and the kinds both use**

In `src/client/clue-kinds.tsx`, immediately below the `export { isAnswerOut }` line from Task 1, add:

```tsx
/**
 * Whether the card is in its reveal state.
 *
 * Driven off the answer text actually being present rather than off the phase,
 * so a clue whose pack row somehow has no answer looks exactly as it does today
 * instead of demoting its question to make room for nothing. The card and every
 * kind read the same predicate, which is what keeps the demoted question and
 * the answer block from ever disagreeing about which layout is on screen.
 */
export function isRevealing(clue: BoardClue): boolean {
  return clue.answer !== null
}
```

- [ ] **Step 2: Render the answer in ClueView**

In `src/client/board/ClueView.tsx`, change the import on line 4 from:

```tsx
import { clueKindFor } from '../clue-kinds.tsx'
```

to:

```tsx
import { clueKindFor, isRevealing } from '../clue-kinds.tsx'
import { FitText } from './FitText.tsx'
```

Add this line just below the existing `const KindBoard = ...`:

```tsx
  const revealing = isRevealing(clue)
```

Change the root element's className from:

```tsx
      className={`clue clue--${clue.kind}${
        clue.stealWinner ? ' clue--buzzed' : ''
      }`}
```

to:

```tsx
      className={`clue clue--${clue.kind}${
        clue.stealWinner ? ' clue--buzzed' : ''
      }${revealing ? ' clue--revealed' : ''}`}
```

Then insert the answer block immediately after `<KindBoard clue={clue} />` and before the `stealWinner` comment block:

```tsx
      <KindBoard clue={clue} />

      {/* The whole point of the change: the answer was only ever spoken, and a
          room of thirty with drinks in hand does not reliably hear it. FitText
          because the stage is a fixed 1920×1080 with overflow hidden — a long
          answer would be clipped in front of everyone rather than wrap. */}
      {clue.answer !== null ? (
        <FitText
          className="clue__answer"
          text={clue.answer}
          max={96}
          min={40}
        />
      ) : null}
```

The render condition is written out rather than reusing `revealing` so TypeScript
narrows `clue.answer` to `string` — `isRevealing` is definitionally the same
check, but a predicate function does not narrow through, and the alternative is
a `!` assertion on the one value this whole change exists to display.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/client/clue-kinds.tsx src/client/board/ClueView.tsx
git commit -m "feat: render the answer on the clue card once it is out"
```

---

## Task 4: The two-band layout

Without this the answer renders unstyled below a full-height question. This task is what makes it the hero.

**Read this before writing the CSS:** `FitText` writes `font-size` as an **inline style** on its box, so CSS cannot resize either band — that is Task 5's job. What CSS must do here is give both bands a *definite* height, because `FitText` measures `clientHeight` and a `flex: 0 0 auto` band would measure itself, always "fit", and grow until it overflowed the card.

**Files:**
- Modify: `src/client/styles.css` — add a new section after the `.clue__prompt--emoji` rule (currently ends around line 587, just before `.clue__sips`)
- Modify: `src/client/styles.css` — add the image override at the end of the `.clue--image` block (currently after the `.clue--image .clue__footer, .clue--image .countdown__seconds` rule, around line 736)

- [ ] **Step 1: Add the answer band**

Insert into `src/client/styles.css` immediately after the `.clue__prompt--emoji { ... }` rule and before `.clue__sips`:

```css
/* ── The answer, once the clue is over ───────────────────────────────────────
   The room's problem is that the answer was only ever spoken across a loud
   flat. So it takes the card: the question demotes to a fixed band under the
   gold rule for anyone who walked in late, and everything below it is the
   answer. Both bands are a definite height because FitText measures its box —
   an auto-height band would always "fit" and grow until it overflowed the TV.

   Anton against the question's UI face, and flat gold rather than the clipped
   gradient .clue__value uses: image clues need an opaque plate behind these
   words, and a background on the inner span would paint over a
   background-clip: text gradient. */
.clue--revealed .clue__prompt {
  flex: 0 0 220px;
}

.clue__answer {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 0 40px 8px;
  font-family: var(--font-display);
  /* Only where FitText starts measuring from — its inline style wins. */
  font-size: 96px;
  line-height: 1.1;
  letter-spacing: .02em;
  text-align: center;
  text-wrap: pretty;
  color: var(--gold-bright);
  text-shadow: 0 6px 0 rgba(0, 0, 0, .55);
  animation: jp-reveal .42s cubic-bezier(.2, .8, .3, 1) both;
}
```

`jp-reveal` already exists (added for the image reveal) — keyframes are global, so this reuses it rather than inventing a second motion for the same beat.

- [ ] **Step 2: Add the image-clue override**

Insert into `src/client/styles.css` immediately after the existing rule:

```css
.clue--image .clue__footer,
.clue--image .countdown__seconds {
  text-shadow: 0 3px 14px rgba(0, 0, 0, .95), 0 0 6px rgba(0, 0, 0, .8);
}
```

add:

```css
/* The photo is absolute at inset 0 and the header takes margin-bottom: auto,
   so a flex: 1 answer would fight the layout instead of filling it. A fixed
   band inside the existing 260px bottom scrim instead — which is already dark
   enough to read gold against, and free by then because a terminal phase has
   no countdown. */
.clue--image .clue__answer {
  flex: 0 0 200px;
  padding: 0 72px;
}

/* A plate only as wide as the words, exactly as .clue__image-caption span does.
   A full-width band would blank a stripe of the photograph that the reveal
   exists to show. */
.clue--image .clue__answer span {
  display: inline-block;
  padding: 8px 32px;
  background: rgba(4, 7, 46, .82);
  box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
}
```

- [ ] **Step 3: Verify the bundle builds**

Run: `pnpm build`
Expected: `✓ built in …`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/client/styles.css
git commit -m "feat: the answer takes the clue card, question demotes to a band"
```

---

## Task 5: Demote each kind's question

The bands exist now; this is what actually shrinks the text inside the top one. Each kind passes `FitText` a smaller range when the answer is out, because `FitText`'s inline `font-size` beats any CSS.

**Files:**
- Modify: `src/client/clue-kinds.tsx` — `TextBoard`, `EmojiBoard`, `AudioHostBoard`

- [ ] **Step 1: Demote the text question**

Replace `TextBoard` in `src/client/clue-kinds.tsx` with:

```tsx
function TextBoard({ clue }: { clue: BoardClue }) {
  // Once the answer is up the question has done its job. It stays on screen for
  // whoever walked in halfway through, but it stops being the thing you read.
  const out = isRevealing(clue)
  return (
    <FitText
      className="clue__prompt"
      text={clue.prompt}
      max={out ? 46 : 92}
      min={out ? 24 : 38}
    />
  )
}
```

- [ ] **Step 2: Demote the emoji question**

Replace `EmojiBoard` with:

```tsx
function EmojiBoard({ clue }: { clue: BoardClue }) {
  // The whole joke is that they are enormous — hence a floor that is still
  // larger than an ordinary prompt's ceiling. Halved once the answer is out:
  // still the biggest thing in the top band, no longer the biggest on the TV.
  const out = isRevealing(clue)
  return (
    <FitText
      className="clue__prompt clue__prompt--emoji"
      text={clue.prompt}
      max={out ? 120 : 240}
      min={out ? 64 : 96}
      step={12}
    />
  )
}
```

- [ ] **Step 3: Demote the audio question**

Replace `AudioHostBoard` with:

```tsx
/** The TV shows the note and the prompt; the music comes off the host phone. */
function AudioHostBoard({ clue }: { clue: BoardClue }) {
  const out = isRevealing(clue)
  return (
    <div className="clue__audio">
      <span className="clue__audio-note" aria-hidden="true">
        ♪
      </span>
      <FitText
        className="clue__prompt"
        text={clue.prompt}
        max={out ? 40 : 80}
        min={out ? 24 : 36}
      />
    </div>
  )
}
```

`ImageBoard` is deliberately untouched: its caption already steps back to 34px under `.clue__image--reveal`, and its photo swap stays keyed on the phase.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm build`
Expected: no typecheck output, then `✓ built in …`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/clue-kinds.tsx
git commit -m "feat: demote the question once the answer is on screen"
```

---

## Task 6: Verify against the deployed app

There is no local runtime. Deploy the branch to Railway (or merge it to `main` if that is how this environment deploys), then drive the app through its own API. `HOST_PIN` is needed for the host calls.

Set these once in your shell — replace with the real Railway domain, room code and PIN:

```bash
export APP=https://<your-railway-domain>
export CODE=<room code>
export PIN=<HOST_PIN>
```

- [ ] **Step 1: Confirm the answer is absent while a clue is live**

Open any unspent tile from the host console (or `POST $APP/api/host/games/$CODE/open`), then:

```bash
curl -s "$APP/api/board/$CODE" | python3 -c "import json,sys; c=json.load(sys.stdin)['activeClue']; print(c['phase'], repr(c['answer']))"
```

Expected: `clue_open None`

- [ ] **Step 2: Confirm it is still absent while a steal is open**

This is the case that matters — a team is about to buzz and can read this endpoint.

```bash
curl -s -X POST "$APP/api/host/games/$CODE/resolve" \
  -H "content-type: application/json" -H "x-host-pin: $PIN" \
  -d '{"outcome":"own_wrong"}' >/dev/null
curl -s "$APP/api/board/$CODE" | python3 -c "import json,sys; c=json.load(sys.stdin)['activeClue']; print(c['phase'], repr(c['answer']))"
```

Expected: `steal_open None`

If the header name is not `x-host-pin`, read `src/server/auth.ts` and use what it actually checks.

- [ ] **Step 3: Confirm it appears when nobody steals**

```bash
curl -s -X POST "$APP/api/host/games/$CODE/resolve" \
  -H "content-type: application/json" -H "x-host-pin: $PIN" \
  -d '{"outcome":"no_steal"}' >/dev/null
curl -s "$APP/api/board/$CODE" | python3 -c "import json,sys; c=json.load(sys.stdin)['activeClue']; print(c['phase'], repr(c['answer']))"
```

Expected: `revealed` and the answer text.

- [ ] **Step 4: Repeat for the other three terminal routes**

Close the clue, open a fresh tile, and check `phase` and `answer` for each:

| Outcome to resolve | Expected phase | Expected `answer` |
|---|---|---|
| `own_correct` | `done` | the text |
| `own_wrong` then `steal_wrong` | `revealed` | the text |
| a Daily Double, wager locked, then `own_wrong` | `revealed` | the text |

- [ ] **Step 5: Measure the TV, don't eyeball it**

Open `$APP/?code=$CODE` in a **foreground** tab (a hidden tab freezes animations and returns zeroed rects), resolve a clue, and check both bands sit inside the 1920×1080 stage:

```js
['.clue__prompt', '.clue__answer'].map(s => {
  const el = document.querySelector(s)
  if (!el) return [s, 'absent']
  const r = el.getBoundingClientRect()
  return [s, Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]
})
```

Expected: `.clue__answer` is present, both rects are inside the stage, and neither overlaps the score strip. Do **not** use `scrollHeight` — this text is centred, so a centred box sheds overflow upward as well as downward and `scrollHeight` reports only the downward half.

- [ ] **Step 6: Check the two awkward content cases**

- An `image` clue: the answer must sit on its plate over the bottom scrim, not over the face the reveal photo exists to show.
- The pack's **longest** answer against its **longest** question, together on one card. Find them with:

```sql
select length(answer) as a, length(payload->>'prompt') as p, answer
from clues order by a desc limit 3;
```

Expected: `FitText` shrinks both to fit; nothing is clipped.

- [ ] **Step 7: Commit anything the measurements forced**

If steps 5-6 required a size or band adjustment:

```bash
git add -A
git commit -m "fix: <what the TV measurement showed>"
```

---

## Out of scope, on purpose

Recorded here so nobody adds them mid-task:

- **A verdict line** ("Ingen klarte den — hele rommet drikker"). Cut by decision.
- **Final Jeopardy's correct answer.** The Final reveal lists every team's written answer but never the right one — the same gap, deliberately left for after the event.
- **A design card** for the reveal state in `design/`.
- **Any change to the host console.** The answer stays behind *Vis fasit* there; that button is for reading the answer *before* deciding, which is a different job.
