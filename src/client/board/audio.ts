/**
 * Every sound the room hears, synthesised (PRD §8.3).
 *
 * Oscillators, not files: a buzzer and a ding are a few lines of WebAudio, and
 * that keeps the repo free of audio assets, the network free of one more thing
 * to fetch at 21:30, and the licence file free of anything to argue about.
 *
 * The board is the only audio device (PRD §8.1). Host and team phones stay
 * silent apart from vibration, so nothing in here is imported by those screens.
 */

type Ctx = AudioContext & { resume(): Promise<void> }

let ctx: Ctx | null = null
let master: GainNode | null = null
let unlocked = false

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
    return unlocked
  } catch {
    // A board with no sound still runs the whole game. Never throw from here.
    return false
  }
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

/** Note names kept out of it: these are the frequencies that sounded right. */
const STINGS: Record<string, () => void> = {
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

export type StingName = keyof typeof STINGS

/**
 * Fire and forget. Silent before the unlock tap, which is correct rather than
 * unfortunate: the alternative is a board that throws on its first render.
 */
export function sting(name: StingName) {
  if (!unlocked || !ctx) return
  try {
    STINGS[name]?.()
  } catch {
    // A dropped sound effect is never worth an error boundary mid-game.
  }
}
