/**
 * Every sound the room hears (PRD §8.3).
 *
 * Two layers, and the order matters. Generated clips from ElevenLabs are
 * pre-loaded into the database and fetched once at the unlock tap; underneath
 * every one of them sits the oscillator that used to be the whole story. If a
 * clip is missing, still in flight, or fails to decode, the synthesised version
 * plays instead — so the worst case is the game exactly as it sounded before
 * any of this existed, rather than a silent room with nothing on screen to say
 * why. Same posture as a clue with no generated speech (PRD §8.2).
 *
 * Nothing here calls a third party. ElevenLabs is invoked only by
 * scripts/generate-sfx.mjs, on a laptop, long before anybody is playing.
 *
 * The board is the only audio device (PRD §8.1). Host and team phones stay
 * silent apart from vibration, so nothing in here is imported by those screens.
 */

import { STING_NAMES, type StingName } from '@shared/stings.ts'

type Ctx = AudioContext & { resume(): Promise<void> }

let ctx: Ctx | null = null
let master: GainNode | null = null
let unlocked = false

/** Decoded clips, by name. Empty until the fetch started at unlock finishes. */
const buffers = new Map<StingName, { buffer: AudioBuffer; gain: number }>()

/** Loud enough across a room, quiet enough not to duck the conversation. */
const MASTER_GAIN = 0.32

export function audioIsUnlocked(): boolean {
  return unlocked
}

/**
 * Must be called from inside a real user gesture — that is the entire reason
 * the board has a "Trykk for å starte" screen at all (PRD §8.1). Browsers
 * create the context suspended otherwise and nothing is ever heard, with no
 * error to explain why.
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioCtor) return false

    ctx ??= new AudioCtor() as Ctx
    master ??= (() => {
      const gain = ctx!.createGain()
      gain.gain.value = MASTER_GAIN
      gain.connect(ctx!.destination)
      return gain
    })()

    await ctx.resume()
    unlocked = ctx.state === 'running'

    // Deliberately not awaited. The tap's job is to resume the context and go
    // fullscreen; making it wait on a network fetch would put a stall between
    // the finger and the lobby, and every sound works without this resolving.
    if (unlocked) void loadGeneratedStings()

    return unlocked
  } catch {
    // A board with no sound still runs the whole game. Never throw from here.
    return false
  }
}

/**
 * Fetches whatever clips the database holds and decodes them once.
 *
 * Decoded up front rather than on first play: `decodeAudioData` on a cold mp3
 * costs tens of milliseconds, and the first sound of the evening is usually a
 * buzz — the one moment where late is worse than synthesised. After this, a
 * sting is a buffer node and starts on the sample.
 *
 * Failure is silent and total by design: any clip that does not arrive simply
 * keeps its oscillator, so a board on a dead venue network sounds like the one
 * that shipped on Sunday.
 */
async function loadGeneratedStings(): Promise<void> {
  if (!ctx) return

  try {
    const response = await fetch('/api/media/show')
    if (!response.ok) return

    const manifest: unknown = await response.json()
    if (!Array.isArray(manifest)) return

    const wanted = manifest.filter(
      (entry): entry is { name: StingName; gain: number } =>
        !!entry &&
        typeof entry.name === 'string' &&
        (STING_NAMES as readonly string[]).includes(entry.name),
    )

    // In parallel, and each one independently: a single 404 or a corrupt clip
    // must not cost the other ten their upgrade.
    await Promise.all(
      wanted.map(async ({ name, gain }) => {
        try {
          const clip = await fetch(`/api/media/show/${name}`)
          if (!clip.ok) return
          const bytes = await clip.arrayBuffer()
          const buffer = await ctx!.decodeAudioData(bytes)
          buffers.set(name, {
            buffer,
            gain: typeof gain === 'number' && gain > 0 ? gain : 1,
          })
        } catch {
          // Keeps the oscillator. Nothing to report and nobody to report it to.
        }
      }),
    )
  } catch {
    // Offline, or no database. Both are survivable and already handled.
  }
}

/** Plays a decoded clip. Returns false if there is nothing loaded for it. */
function playBuffer(name: StingName): boolean {
  const entry = buffers.get(name)
  if (!entry || !ctx || !master) return false

  const source = ctx.createBufferSource()
  const trim = ctx.createGain()

  source.buffer = entry.buffer
  trim.gain.value = entry.gain

  source.connect(trim)
  trim.connect(master)
  source.start()
  return true
}

interface ToneOptions {
  freq: number
  /** Seconds from now. */
  at?: number
  dur?: number
  type?: OscillatorType
  gain?: number
  /** Glide to this frequency across the note — a drop reads as "wrong". */
  slideTo?: number
}

function tone({
  freq,
  at = 0,
  dur = 0.18,
  type = 'sine',
  gain = 0.6,
  slideTo,
}: ToneOptions) {
  if (!ctx || !master) return
  const start = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const env = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur)

  // A hard start or stop on a raw oscillator is an audible click, which on a
  // TV at volume sounds like the speaker is broken. 12 ms each end fixes it.
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  env.gain.setValueAtTime(gain, start + Math.max(0.012, dur - 0.05))
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)

  osc.connect(env)
  env.connect(master)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/**
 * The synthesised layer, and the reason a missing clip is not a problem.
 *
 * Typed against StingName rather than string so that adding a name to the
 * shared list without giving it a fallback is a compile error — a sound with no
 * oscillator behind it would be silent on any board that failed to fetch.
 *
 * Note names kept out of it: these are the frequencies that sounded right.
 */
const STINGS: Record<StingName, () => void> = {
  /** A tile opening: short rising blip. */
  tileOpen: () => {
    tone({ freq: 440, slideTo: 880, dur: 0.13, type: 'triangle', gain: 0.5 })
  },

  /** The buzzer. Deliberately ugly — it has to cut through a loud room. */
  buzz: () => {
    tone({ freq: 196, slideTo: 150, dur: 0.34, type: 'square', gain: 0.42 })
    tone({ freq: 98, slideTo: 75, dur: 0.34, type: 'sawtooth', gain: 0.3 })
  },

  /** Correct: a major triad walked upward. */
  correct: () => {
    tone({ freq: 523.25, at: 0, dur: 0.12, type: 'triangle', gain: 0.5 })
    tone({ freq: 659.25, at: 0.1, dur: 0.12, type: 'triangle', gain: 0.5 })
    tone({ freq: 783.99, at: 0.2, dur: 0.26, type: 'triangle', gain: 0.55 })
  },

  /** Wrong: two notes down, the game-show "aww". */
  wrong: () => {
    tone({ freq: 311.13, at: 0, dur: 0.16, type: 'square', gain: 0.32 })
    tone({ freq: 233.08, at: 0.14, dur: 0.34, type: 'square', gain: 0.32 })
  },

  /** One second of clock left. Quiet: it fires five times in a row. */
  tick: () => {
    tone({ freq: 1180, dur: 0.035, type: 'square', gain: 0.16 })
  },

  /** The clock running out. */
  timeUp: () => {
    tone({ freq: 174.61, slideTo: 110, dur: 0.55, type: 'sawtooth', gain: 0.34 })
  },

  /** Daily Double: the board slams gold, so this has to arrive with it. */
  dailyDouble: () => {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) =>
      tone({ freq, at: i * 0.075, dur: 0.2, type: 'square', gain: 0.34 }),
    )
    tone({ freq: 1318.5, at: 0.42, dur: 0.5, type: 'triangle', gain: 0.42 })
  },

  /** A new round landing. */
  roundStart: () => {
    const notes = [261.63, 329.63, 392, 523.25]
    notes.forEach((freq, i) =>
      tone({ freq, at: i * 0.11, dur: 0.24, type: 'triangle', gain: 0.45 }),
    )
    tone({ freq: 783.99, at: 0.44, dur: 0.7, type: 'triangle', gain: 0.5 })
    tone({ freq: 523.25, at: 0.44, dur: 0.7, type: 'sine', gain: 0.35 })
  },

  /** Final Jeopardy, announced. Low and slow. */
  final: () => {
    tone({ freq: 110, slideTo: 220, dur: 1.1, type: 'sawtooth', gain: 0.24 })
    tone({ freq: 329.63, at: 0.55, dur: 0.6, type: 'triangle', gain: 0.4 })
  },

  /** Somebody won the whole thing. */
  winner: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    notes.forEach((freq, i) =>
      tone({ freq, at: i * 0.09, dur: 0.22, type: 'triangle', gain: 0.45 }),
    )
    tone({ freq: 1046.5, at: 0.5, dur: 0.9, type: 'triangle', gain: 0.5 })
    tone({ freq: 1567.98, at: 0.5, dur: 0.9, type: 'sine', gain: 0.3 })
  },

  /** Nobody stole it. Triple stumper — the whole room drinks. */
  stumper: () => {
    tone({ freq: 220, at: 0, dur: 0.18, type: 'square', gain: 0.26 })
    tone({ freq: 207.65, at: 0.16, dur: 0.18, type: 'square', gain: 0.26 })
    tone({ freq: 196, at: 0.32, dur: 0.5, type: 'square', gain: 0.26 })
  },
}

export type { StingName }

/**
 * Fire and forget. Silent before the unlock tap, which is correct rather than
 * unfortunate: the alternative is a board that throws on its first render.
 *
 * The generated clip wins when there is one; otherwise the oscillator does the
 * job it has always done. Both paths are inside the same try, because a sound
 * effect that throws must never take a tile-open down with it.
 */
export function sting(name: StingName) {
  if (!unlocked || !ctx) return
  try {
    if (playBuffer(name)) return
    STINGS[name]?.()
  } catch {
    // A dropped sound effect is never worth an error boundary mid-game.
  }
}
