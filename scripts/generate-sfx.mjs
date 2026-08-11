import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { STING_NAMES } from '../src/shared/stings.ts'

/**
 * Generates the eleven stings with ElevenLabs, so the board plays recorded
 * sound instead of oscillators (PRD §8.3).
 *
 * Deliberately a laptop script and not a server job, for the same reason the
 * voice pipeline is a batch: nothing on the critical path may call a third
 * party at play time. ElevenLabs is touched here, hours early, and the game
 * only ever reads bytes out of its own Postgres.
 *
 * Generate, then LISTEN, then upload. That loop is the whole point — a prompt
 * that reads well produces a buzzer that is too polite about half the time,
 * and the only way to know is to play it.
 *
 *   node scripts/generate-sfx.mjs                # generate whatever is missing
 *   node scripts/generate-sfx.mjs buzz winner    # re-roll just these two
 *   node scripts/generate-sfx.mjs --all          # re-roll everything
 *   node scripts/generate-sfx.mjs --list         # what is on disk
 *   node scripts/generate-sfx.mjs --upload       # push media/sfx into the app
 *
 * Raw downloads are kept beside the processed files, so re-processing after a
 * change to the trim never costs another generation.
 *
 * Needs ELEVENLABS_API_KEY to generate, plus APP_URL and ADMIN_PIN to upload.
 * The prompts are committed; they contain no answers, only descriptions of
 * noises, so they stay on the safe side of the content rule.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}media/sfx`
const rawDir = `${outDir}/raw`

if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`)

/**
 * One prompt per sting, in a consistent register so eleven separate generations
 * sound like one show rather than eleven stock libraries. Durations are the
 * shortest that still lets the sound finish — a sting that outlasts the moment
 * it marks is worse than no sting.
 */
const PROMPTS = {
  tileOpen: {
    seconds: 0.8,
    text: 'Short bright rising blip, retro TV game show tile reveal, clean vibraphone-like ping, single hit, no music, no reverb tail',
  },
  buzz: {
    seconds: 1.2,
    text: 'Loud harsh classic TV game show buzzer, low rasping electric buzz, single aggressive blast, cuts through a noisy room, dry',
  },
  correct: {
    seconds: 1.5,
    text: 'Cheerful correct answer chime, 1970s TV game show, bright ascending vibraphone and bell, warm and short, no music bed',
  },
  wrong: {
    seconds: 1.5,
    text: 'Classic game show wrong answer sound, descending muted trombone womp, comedic and deflating, dry, single hit',
  },
  tick: {
    seconds: 0.5,
    text: 'Single dry mechanical clock tick, crisp quiet wooden click, one hit only, no reverb, no music',
  },
  timeUp: {
    seconds: 1.6,
    text: 'Time is up buzzer, descending electronic tone ending flat, 1970s TV game show, final and blunt, dry',
  },
  dailyDouble: {
    seconds: 2.5,
    text: 'Exciting TV game show fanfare sting, bright ascending brass stabs with vibraphone flourish, celebratory surprise reveal, retro big band, punchy',
  },
  roundStart: {
    seconds: 2.5,
    text: 'Retro 1970s TV game show round opening fanfare, confident brass section stab with vibraphone and walking bass, upbeat, short',
  },
  final: {
    seconds: 3,
    text: 'Dramatic low suspenseful sting announcing the final round of a TV game show, deep brass swell with timpani roll, tense, cinematic, retro',
  },
  winner: {
    seconds: 3,
    text: 'Triumphant TV game show victory fanfare, full retro brass band ascending to a bright held chord, celebratory, no applause, no crowd',
  },
  stumper: {
    seconds: 2,
    text: 'Deflating comedic game show sound for nobody answering, descending muted brass with a soft cymbal, disappointed, dry, retro',
  },
}

/**
 * Playback level per sting, uploaded into show_media.gain.
 *
 * Normalisation gets all eleven to the same peak, which is a baseline and not a
 * mix: played flat, the countdown tick would arrive as loud as the buzzer, and
 * it fires five times in a row. These ratios are lifted from the oscillator
 * gains in audio.ts, which were tuned by ear against a room — the buzzer on top
 * because it has to cut through a vorspiel, the tick well under everything.
 *
 * In the database rather than baked into the mp3 so it stays tunable against
 * the actual TV without regenerating or redeploying anything.
 */
const MIX = {
  tileOpen: 0.75,
  buzz: 1,
  correct: 0.85,
  wrong: 0.7,
  tick: 0.3,
  timeUp: 0.7,
  dailyDouble: 0.9,
  roundStart: 0.9,
  final: 0.8,
  winner: 1,
  stumper: 0.6,
}

// A name in one list and not the other is silent with no error anywhere.
const missingPrompt = STING_NAMES.filter((name) => !PROMPTS[name])
const strayPrompt = Object.keys(PROMPTS).filter(
  (name) => !STING_NAMES.includes(name),
)
const missingMix = STING_NAMES.filter((name) => typeof MIX[name] !== 'number')
if (missingPrompt.length || strayPrompt.length || missingMix.length) {
  console.error(
    `Prompt table is out of sync with STING_NAMES.\n` +
      (missingPrompt.length ? `  no prompt for: ${missingPrompt.join(', ')}\n` : '') +
      (strayPrompt.length ? `  no sting named: ${strayPrompt.join(', ')}\n` : '') +
      (missingMix.length ? `  no mix level for: ${missingMix.join(', ')}\n` : ''),
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const named = args.filter((a) => !a.startsWith('--'))

const unknownName = named.find((n) => !STING_NAMES.includes(n))
if (unknownName) {
  console.error(`Unknown sting "${unknownName}".\nKnown: ${STING_NAMES.join(', ')}`)
  process.exit(1)
}

mkdirSync(rawDir, { recursive: true })

const processedPath = (name) => `${outDir}/${name}.mp3`
const rawPath = (name) => `${rawDir}/${name}.mp3`

// ─── listing ─────────────────────────────────────────────────────────────────

if (flags.has('--list')) {
  for (const name of STING_NAMES) {
    const path = processedPath(name)
    const size = existsSync(path)
      ? `${Math.round(readFileSync(path).length / 1024)} kB`
      : '—'
    console.log(`${existsSync(path) ? '✓' : '·'} ${name.padEnd(12)} ${size}`)
  }
  process.exit(0)
}

// ─── ffmpeg: trim the lead-in, level the set ─────────────────────────────────

/**
 * Generated clips routinely arrive with 100–300 ms of silence in front. On the
 * buzzer that is a latency bug in the one sound that has to feel instant, so it
 * comes off before anything is uploaded.
 *
 * Peak normalisation rather than LUFS: these are one-shots, several under two
 * seconds, and loudnorm's measurement window is unreliable at that length.
 */
function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'buffer',
  })
}

/**
 * ffmpeg writes volumedetect's report to stderr and still exits 0, so this has
 * to be spawnSync reading stderr. execFileSync returns stdout, which for
 * `-f null -` is empty — it parses to null, every measurement silently becomes
 * "no change", and the quietest clip stays 26 dB under the buzzer.
 */
function peakDb(path) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const match = /max_volume:\s*(-?[\d.]+) dB/.exec(result.stderr ?? '')
  return match ? Number(match[1]) : null
}

const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0'
/** Just under full scale, so nothing clips on a TV's own limiter. */
const TARGET_PEAK_DB = -1

function process_(name) {
  const raw = rawPath(name)
  if (!existsSync(raw)) return false

  const peak = peakDb(raw)
  const gainDb = peak === null ? 0 : TARGET_PEAK_DB - peak
  const filters = `${TRIM},volume=${gainDb.toFixed(2)}dB`

  ffmpeg(['-y', '-i', raw, '-af', filters, '-codec:a', 'libmp3lame', '-q:a', '4', processedPath(name)])

  const before = readFileSync(raw).length
  const after = readFileSync(processedPath(name)).length
  console.log(
    `  trimmed & levelled ${name} (${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB, ${Math.round(before / 1024)}→${Math.round(after / 1024)} kB)`,
  )
  return true
}

// ─── generation ──────────────────────────────────────────────────────────────

async function generate(name) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set — add it to .env')
    process.exit(1)
  }

  const { text, seconds } = PROMPTS[name]
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: seconds }),
  })

  if (!response.ok) {
    console.error(`✗ ${name}: HTTP ${response.status} ${await response.text()}`)
    return false
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(rawPath(name), bytes)
  const cost = response.headers.get('character-cost') ?? '?'
  console.log(`✓ ${name} — ${Math.round(bytes.length / 1024)} kB, ${cost} credits`)
  process_(name)
  return true
}

// ─── upload ──────────────────────────────────────────────────────────────────

async function upload() {
  const appUrl = process.env.APP_URL?.replace(/\/$/, '')
  const pin = process.env.ADMIN_PIN
  if (!appUrl || !pin) {
    console.error('APP_URL and ADMIN_PIN must be set to upload — add them to .env')
    process.exit(1)
  }

  let sent = 0
  for (const name of STING_NAMES) {
    const path = processedPath(name)
    if (!existsSync(path)) {
      console.log(`· ${name} — nothing on disk, keeps its oscillator`)
      continue
    }

    const bytes = readFileSync(path)
    const response = await fetch(`${appUrl}/api/admin/show-media/${name}`, {
      method: 'PUT',
      headers: { 'x-pin': pin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mime: 'audio/mpeg',
        base64: bytes.toString('base64'),
        gain: MIX[name],
        prompt: PROMPTS[name].text,
        durationMs: Math.round(PROMPTS[name].seconds * 1000),
      }),
    })

    if (!response.ok) {
      console.error(`✗ ${name}: HTTP ${response.status} ${await response.text()}`)
      continue
    }
    console.log(
      `↑ ${name} — ${Math.round(bytes.length / 1024)} kB @ gain ${MIX[name]}`,
    )
    sent++
  }

  console.log(
    `\nUploaded ${sent}/${STING_NAMES.length}. The board picks these up on its next` +
      `\n"Trykk for å starte" — reload the TV to hear them.`,
  )
}

// ─── what to do ──────────────────────────────────────────────────────────────

if (flags.has('--process')) {
  // Re-trims and re-levels from the raw downloads. Costs nothing, so it is the
  // right thing to run after touching the filter chain rather than re-rolling.
  const done = STING_NAMES.filter((name) => process_(name))
  console.log(`\nRe-processed ${done.length}/${STING_NAMES.length} from media/sfx/raw/.`)
} else if (flags.has('--upload')) {
  await upload()
} else {
  const targets = named.length
    ? named
    : flags.has('--all')
      ? STING_NAMES
      : STING_NAMES.filter((name) => !existsSync(rawPath(name)))

  if (!targets.length) {
    console.log(
      'Everything is already generated. Use --all, or name the ones to re-roll:' +
        `\n  node scripts/generate-sfx.mjs buzz winner`,
    )
    process.exit(0)
  }

  console.log(`Generating ${targets.length}: ${targets.join(', ')}\n`)
  let ok = 0
  for (const name of targets) if (await generate(name)) ok++

  console.log(
    `\n${ok}/${targets.length} generated into media/sfx/.` +
      `\n\nListen to them before uploading — that is the entire point of doing this` +
      `\nin advance. Re-roll anything weak by name, then:` +
      `\n  node scripts/generate-sfx.mjs --upload`,
  )
}
