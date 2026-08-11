import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/**
 * Embeds image files into a clue pack, so the thirteen picture clues can arrive
 * one at a time instead of in one sitting with base64 on the clipboard.
 *
 * Drop files into `packs/media/` named `<category>-<tier>.<ext>`, e.g.
 * `kjendisoyne-2.jpg`. Category slugs and tiers are not answers — they are on
 * the board all evening — so this script and its convention stay content-free
 * and committable. The images themselves land in `packs/`, which is gitignored.
 *
 *   node scripts/embed-images.mjs [pack.json]
 *
 * Re-running is safe: it overwrites whatever bytes a clue already had, which is
 * also how you replace a crop you have decided against.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const packPath = process.argv[2] ?? `${root}packs/fadderuke-2026.pack.json`
const mediaDir = `${root}packs/media`

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** "Zoomet inn" -> "zoomet-inn"; "Kjendisøyne" -> "kjendisoyne". */
const slug = (name) =>
  name
    .toLowerCase()
    .replaceAll('ø', 'o')
    .replaceAll('æ', 'ae')
    .replaceAll('å', 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

if (!existsSync(mediaDir)) {
  console.error(`No ${mediaDir} — create it and drop images in.`)
  process.exit(1)
}

const pack = JSON.parse(readFileSync(packPath, 'utf8'))

// Every slot that wants a picture, keyed the way a filename spells it.
const slots = new Map()
for (const round of pack.rounds) {
  for (const category of round.categories) {
    for (const clue of category.clues) {
      if (clue.payload.kind !== 'image') continue
      // Half of a paired category is filed under its own label: the paintings
      // live in a category *named* "Musikk", and "musikk-1.jpg" for Skrik would
      // be a trap at two in the morning.
      const label = clue.fromLabel ?? category.name
      slots.set(`${slug(label)}-${clue.tier}`, { clue, category, round, label })
    }
  }
}

const files = readdirSync(mediaDir).filter((f) => !f.startsWith('.'))
let embedded = 0

for (const file of files) {
  const ext = file.split('.').pop().toLowerCase()
  const key = file.slice(0, -(ext.length + 1)).toLowerCase()
  const mime = MIME[ext]

  if (!mime) {
    console.warn(`· skipped ${file} — not an image extension`)
    continue
  }
  // "kjendisoyne-1-reveal.jpg" is the whole picture shown once the answer is
  // out; "kjendisoyne-1.jpg" is the crop that asks the question.
  const isReveal = key.endsWith('-reveal')
  const slot = slots.get(isReveal ? key.slice(0, -'-reveal'.length) : key)
  if (!slot) {
    console.warn(`· skipped ${file} — no image clue named "${key}"`)
    continue
  }

  const bytes = readFileSync(`${mediaDir}/${file}`)
  const field = isReveal ? 'revealImage' : 'image'
  slot.clue[field] = { mime, base64: bytes.toString('base64') }
  if (!isReveal) embedded++
  const value = slot.round.valueStep * slot.clue.tier
  console.log(
    `✓ ${slot.label} ${value}${isReveal ? ' (fasit)' : ''} ← ${file} (${Math.round(bytes.length / 1024)} kB)`,
  )
}

const missing = [...slots.entries()].filter(([, s]) => !s.clue.image)

writeFileSync(packPath, JSON.stringify(pack, null, 1) + '\n')
const reveals = [...slots.values()].filter((s) => s.clue.revealImage).length
console.log(
  `\nembedded ${embedded} question images (+${reveals} reveal), still missing ${missing.length}`,
)
if (missing.length) {
  console.log('needs a file named:')
  for (const [key] of missing) console.log(`  packs/media/${key}.jpg`)
}
console.log(
  '\nReveal pictures are optional — add "-reveal" before the extension,\ne.g. packs/media/kjendisoyne-1-reveal.jpg',
)
