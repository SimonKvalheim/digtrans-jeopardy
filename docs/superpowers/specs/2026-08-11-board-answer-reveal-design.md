# The answer on the board

**Date:** 2026-08-11 (event day)
**Status:** approved

## The problem

When a clue finishes, the TV keeps showing the question and nothing else. The
answer exists only on the host console, behind *Vis fasit*, which means the only
way thirty people find out what the answer was is by listening to Simon say it
across a loud room. PRD §3.1 already lists "answer reveal" as a board state; it
was never built.

## What already exists

- The clue state machine has two terminal phases — `done` (somebody got it) and
  `revealed` (nobody did). The tile stays on the TV through both until the host
  taps *Lukk ruten og gi turen videre*. **The moment to show the answer already
  exists.** Nothing in `game/loop.ts` changes.
- `isAnswerOut(phase)` in `client/clue-kinds.tsx` already gates the image
  reveal: once a clue is terminal, an `image` clue swaps its crop for the whole
  picture.
- `useStings` already fires `correct` / `wrong` / `stumper` on exactly these
  transitions, so sound and reveal land together with no new wiring.

The gap is narrow: `activeClue` in the board payload has no `answer` field, and
`ClueView` has nothing to draw.

## Decisions

| Question | Decision |
|---|---|
| Which outcomes reveal? | Both. `done` and `revealed` alike. |
| Layout | The answer takes over: the question demotes to a small band at the top, the answer fills the card in gold. |
| Trigger | Automatic the instant the clue reaches a terminal phase. No extra host tap. |
| Verdict line ("Ingen klarte den") | Out of scope. |
| Final Jeopardy's correct answer | Out of scope. |

Scope was deliberately cut to the single change on the day of the event.

## Where the answer is gated

**On the server.** `/api/board/:code` only ever contains `answer` once the clue
is terminal.

Rejected: sending the answer always and hiding it in the client. The board route
is unauthenticated by design — the TV is a borrowed laptop nobody wants to type
a PIN into — so any team could `curl /api/board/:code` and read the answer to
the clue they are currently staring at.

Rejected: a second endpoint for the answer. Another fetch and another failure
mode on the poll loop, for no gain.

### `src/shared/clue-kinds.ts`

`isAnswerOut` moves here from `client/clue-kinds.tsx`. The server cannot import
from the client, and `game/state.ts` already carries a second copy of the same
predicate as `SPENT_PHASES`. Two copies of "which phases are terminal" is
tolerable while it only decides tile greying; it is not tolerable once one of
them decides whether an answer leaks.

```ts
/** Phases in which the answer is already public to the room. */
export const ANSWER_OUT_PHASES = ['revealed', 'done'] as const

export function isAnswerOut(phase: string): boolean {
  return (ANSWER_OUT_PHASES as readonly string[]).includes(phase)
}
```

`client/clue-kinds.tsx` re-exports it so existing imports keep working.
`game/state.ts` drops `SPENT_PHASES` and uses `isAnswerOut` for tile `spent`.

### `src/shared/board-state.ts`

One field on `activeClue`:

```ts
/**
 * The correct answer — but only once the clue is terminal. Null in every
 * other phase, and decided on the server rather than hidden by the board:
 * /api/board/:code is unauthenticated, so an answer that reaches this payload
 * early is an answer a team can curl mid-clue.
 */
answer: string | null
```

### `src/server/game/state.ts`

`buildActiveClue` selects `schema.clues.answer` and returns
`answer: isAnswerOut(row.phase) ? row.answer : null`.

## What the board draws

`ClueView` adds `clue--revealed` to the root and renders one shared answer block
immediately after `<KindBoard>`:

```tsx
{clue.answer ? (
  <FitText className="clue__answer" text={clue.answer} max={96} min={40} />
) : null}
```

Both the modifier class and the block are driven off `clue.answer` being
non-null, **not** off the phase. If an answer is ever missing, the clue looks
exactly as it does today rather than demoting the question to make room for
nothing.

The answer goes through `FitText` like everything else on this stage. Answers
are short, but the pack is authored by a human and a 1920×1080 stage with
`overflow: hidden` clips silently.

## The layout mechanic

This is the part that can go wrong in front of the room, so it is written down.

`FitText` writes `font-size` as an **inline style** on its box. Two consequences:

1. CSS cannot shrink the question. The demotion has to come from smaller
   `max`/`min` props, which `FitText` re-runs on (`[text, max, min, step]`).
2. `FitText` needs a **definite** box to measure against. A `flex: 0 0 auto`
   band would measure itself, always "fit", and grow until it overflowed the
   card.

So the reveal is two definite bands inside the clue's existing flex column:

```css
.clue--revealed .clue__prompt { flex: 0 0 220px; }        /* question, demoted */
.clue__answer { flex: 1; min-height: 0; }                 /* answer, the hero */
```

220px is a fixed pixel band rather than a percentage: this board is a fixed
1920×1080 stage, so px is its native unit and needs no assumption about whether
an ancestor's height resolves.

Per-kind question sizes when the answer is out:

| kind | normal | revealed |
|---|---|---|
| `text` (also `audio_file`, `video`) | 92 / 38 | 46 / 24 |
| `emoji` | 240 / 96 | 120 / 64 |
| `audio_host` | 80 / 36 | 40 / 24 |
| `image` | — | unchanged; the caption already drops to 34px and the reveal photo swaps in |

### Styling

`.clue__answer` uses `--font-display` (Anton) against the question's `--font-ui`,
in flat `--gold-bright` with the prompt's hard text-shadow. It centres its text
the same way `.clue__prompt` does, because `FitText` renders a `<div>` wrapping
a `<span>` and the span has to be centred inside a band taller than itself:

```css
.clue__answer {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 0 40px 8px;
  font-family: var(--font-display);
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

The `font-size` there is only the value `FitText` starts measuring from; the
inline style it writes wins.

Deliberately **not** the gradient-clipped treatment `.clue__value` uses: image
clues need an opaque plate behind the answer, and a background on the inner
`<span>` would paint straight over a `background-clip: text` gradient.

Entry animation reuses the existing `jp-reveal` keyframes. No new motion.

### Image clues

The one per-kind override. `.clue--image` puts the photo at `inset: 0` and
`position: absolute`, with the header taking `margin-bottom: auto`, so a
`flex: 1` answer would fight the layout. Instead:

```css
.clue--image .clue__answer {
  flex: 0 0 200px;
  padding: 0 72px;
}

/* A plate only as wide as the words, exactly as .clue__image-caption span does
   — a full-width band would blank a stripe of the photograph the reveal exists
   to show. */
.clue--image .clue__answer span {
  display: inline-block;
  padding: 8px 32px;
  background: rgba(4, 7, 46, .82);
  box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
}
```

200px sits inside the existing 260px bottom scrim, which is already dark enough
to read gold against. The countdown is gone by then (`phaseEndsAt` is null in a
terminal phase), so the space is free.

## What deliberately does not change

- **The state machine.** No new phase, no new transition, no new host action.
- **`own_wrong` and timeout go to `steal_open`, which is not terminal** — no
  answer while a steal is live. This falls out of the gate for free rather than
  needing its own condition.
- **The stings.** Already fire on these transitions.
- **The host console.** The answer stays behind *Vis fasit* there too; that
  button is for reading the answer *before* deciding, which is a different job.
- **Undo.** It reverses score events, never clue phases, so it cannot un-reveal
  an answer and does not interact with this.
- **Final Jeopardy.** Out of scope by decision above.

## Verification

There is no local runtime for this project; the deployed Railway app is driven
through its own API.

1. Open a clue. `GET /api/board/:code` → `activeClue.answer` is `null` during
   `clue_open`.
2. Resolve `own_wrong`. Phase is `steal_open`; `answer` is still `null`. This is
   the leak that matters — a team is about to buzz.
3. Let the steal timer run out (`no_steal`). Phase `revealed`; `answer` is the
   text, and the TV shows it.
4. Repeat for `own_correct` (`done`), `steal_wrong` (`revealed`), and a Daily
   Double wrong (`revealed`, no steal).
5. On the TV, measure the rendered bounding boxes of `.clue__prompt` and
   `.clue__answer` against the 1920×1080 stage — not `scrollHeight`, which
   reports only the downward half of a centred box's overflow.
6. Check a long answer and a long question together, and an `image` clue where
   the answer sits over the reveal photo.
