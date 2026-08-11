import { useState, type ReactNode } from 'react'
import type { BoardState } from '@shared/board-state.ts'
import type { ClueKind } from '@shared/clue-kinds.ts'
import type { HostActiveClue } from './host/api.ts'
import { FitText } from './board/FitText.tsx'

/**
 * The clue-kind registry (PRD §6.4) — a registry, deliberately, not a switch.
 *
 * A new kind is: a payload variant in shared/clue-kinds.ts, a `Board` renderer
 * here, and an optional `Host` control. Nothing in the game loop changes, which
 * is the whole claim the architecture makes about itself.
 */

export type BoardClue = NonNullable<BoardState['activeClue']>

export interface ClueKindDef {
  /** What the TV shows. Never the answer. */
  Board: (props: { clue: BoardClue }) => ReactNode
  /** An extra control on the host console, if the kind needs one. */
  Host?: (props: { clue: HostActiveClue }) => ReactNode
}

/**
 * Addressed by game_clues.id — the per-night row the board already holds — so
 * that content ids stay server-side. See routes/media.ts.
 */
export function clueImageUrl(gameClueId: string): string {
  return `/api/media/${gameClueId}/image`
}

/** The whole picture behind the crop, fetched only once the answer is out. */
export function clueRevealImageUrl(gameClueId: string): string {
  return `/api/media/${gameClueId}/reveal`
}

/**
 * Phases in which the answer is already public: `revealed` is nobody getting
 * it, `done` is somebody getting it. The tile stays on screen through both
 * until the host closes it, and the room wants the full picture in either.
 */
export function isAnswerOut(phase: string): boolean {
  return phase === 'revealed' || phase === 'done'
}

function TextBoard({ clue }: { clue: BoardClue }) {
  return <FitText className="clue__prompt" text={clue.prompt} max={92} min={38} />
}

function EmojiBoard({ clue }: { clue: BoardClue }) {
  // The whole joke is that they are enormous — hence a floor that is still
  // larger than an ordinary prompt's ceiling.
  return (
    <FitText
      className="clue__prompt clue__prompt--emoji"
      text={clue.prompt}
      max={240}
      min={96}
      step={12}
    />
  )
}

/**
 * Full-bleed (PRD §6.4), but the photo itself is never cropped.
 *
 * These clues are *already* crops — a tight detail of a building, an eye —
 * so letting `cover` trim the edges to fill a 16:9 stage would throw away the
 * part that makes the question answerable. The photo is therefore contained,
 * and a blurred, scaled copy of itself fills whatever is left. It reads as
 * edge-to-edge from the sofa and loses nothing.
 */
function ImageBoard({ clue }: { clue: BoardClue }) {
  const [failed, setFailed] = useState(false)
  const [revealFailed, setRevealFailed] = useState(false)

  // Once the answer is out, the crop has done its job and the room wants the
  // whole picture. A missing or broken reveal falls back to the crop rather
  // than to nothing — the question image is always the safe thing to show.
  const revealing =
    isAnswerOut(clue.phase) && clue.hasRevealImage && !revealFailed
  const src = revealing ? clueRevealImageUrl(clue.id) : clueImageUrl(clue.id)

  // Missing bytes is a normal authoring state, and the host still has to be
  // able to run the clue: fall back to the prompt, and say why it is bare so
  // nobody stands there waiting for a picture that is never coming.
  if ((!clue.hasImage && !revealing) || (failed && !revealing)) {
    return (
      <div className="clue__image clue__image--missing">
        <FitText className="clue__prompt" text={clue.prompt} max={92} min={38} />
        <p className="clue__image-note">Bildet mangler — les spørsmålet høyt.</p>
      </div>
    )
  }

  return (
    <div className={`clue__image${revealing ? ' clue__image--reveal' : ''}`}>
      <div
        className="clue__image-backdrop"
        style={{ backgroundImage: `url("${src}")` }}
        aria-hidden="true"
      />
      <img
        // Keyed so swapping to the reveal genuinely replaces the element and
        // replays the fade, rather than mutating src on the same <img> and
        // leaving the old photo up until the new bytes decode.
        key={revealing ? 'reveal' : 'clue'}
        className="clue__image-photo"
        src={src}
        alt=""
        onError={() => (revealing ? setRevealFailed(true) : setFailed(true))}
      />
      {/* The span is load-bearing: it is what lets the plate behind the text
          hug the words instead of blanking a full-width band of photograph. */}
      <p className="clue__image-caption">
        <span>{clue.prompt}</span>
      </p>
    </div>
  )
}

/** The TV shows the note and the prompt; the music comes off the host phone. */
function AudioHostBoard({ clue }: { clue: BoardClue }) {
  return (
    <div className="clue__audio">
      <span className="clue__audio-note" aria-hidden="true">
        ♪
      </span>
      <FitText className="clue__prompt" text={clue.prompt} max={80} min={36} />
    </div>
  )
}

/** The host phone is the music player, so the link belongs under his thumb. */
function SpotifyTapCard({ clue }: { clue: HostActiveClue }) {
  if (!clue.payload.link) return null
  return (
    <a
      className="btn btn--primary spor__spotify"
      href={clue.payload.link}
      target="_blank"
      rel="noreferrer"
    >
      ▶ Spill av{clue.payload.hint ? ` — ${clue.payload.hint}` : ''}
    </a>
  )
}

/** The host needs to see the picture too, or he cannot judge a near-miss. */
function ImageThumb({ clue }: { clue: HostActiveClue }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className="muted">Bildet mangler i basen.</p>
  return (
    <img
      className="spor__thumb"
      src={clueImageUrl(clue.gameClueId)}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

export const clueKinds: Record<ClueKind, ClueKindDef> = {
  text: { Board: TextBoard },
  emoji: { Board: EmojiBoard },
  image: { Board: ImageBoard, Host: ImageThumb },
  audio_host: { Board: AudioHostBoard, Host: SpotifyTapCard },
  // Declared to prove the seam is real. Not Tuesday work — both fall back to
  // the prompt, which is exactly what "unimplemented" should look like on a TV.
  audio_file: { Board: TextBoard },
  video: { Board: TextBoard },
}

/** An unknown kind must still render something rather than blank the board. */
export function clueKindFor(kind: string): ClueKindDef {
  return clueKinds[kind as ClueKind] ?? { Board: TextBoard }
}
