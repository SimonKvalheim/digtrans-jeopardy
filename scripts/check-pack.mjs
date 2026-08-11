import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { packSchema, validateForPublish } from '../src/shared/pack-schema.ts'

/**
 * Runs both halves of the import gate against a pack file, offline.
 *
 *   pnpm pack:check [packs/fadderuke-2026.pack.json]
 *
 * Import is all-or-nothing: one misspelled field rejects sixty good clues, and
 * finding that out from a curl at half past nine is the wrong time. This is the
 * same `packSchema` + `validateForPublish` the server runs, so a pack that
 * passes here fails the deployed route only if the two have drifted.
 *
 * It also prints the board as a grid, which is how you notice that the 500 in
 * one category is a gimme — the mistake the validator cannot see.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const packPath = process.argv[2] ?? `${root}packs/fadderuke-2026.pack.json`

const parsed = packSchema.safeParse(JSON.parse(readFileSync(packPath, 'utf8')))

if (!parsed.success) {
  console.error(`✗ ${packPath} — strukturen holder ikke:\n`)
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(rot)'} — ${issue.message}`)
  }
  process.exit(1)
}

const pack = parsed.data
const problems = validateForPublish(pack)

for (const round of pack.rounds) {
  const tiles = round.categories.reduce((n, c) => n + c.clues.length, 0)
  console.log(
    `\n${round.kind}  ${round.categories.length} kategorier · ${tiles} ruter · ` +
      `verdisteg ${round.valueStep} · ${round.dailyDoubles} daily double`,
  )
  for (const category of round.categories) {
    const row = [...category.clues]
      .sort((a, b) => a.tier - b.tier)
      .map((clue) => {
        const value = round.valueStep * clue.tier
        // A picture clue with no bytes is the one failure that looks fine in a
        // text file and is a blank screen in front of the room.
        const missing = clue.payload.kind === 'image' && !clue.image ? '!' : ''
        return `${value}${missing}`.padStart(6)
      })
      .join('')
    console.log(`  ${category.name.padEnd(22)}${row}`)
  }
}

if (problems.length) {
  console.error('\n✗ kan ikke publiseres:\n')
  for (const problem of problems) {
    console.error(`  ${problem.path} — ${problem.message}`)
  }
  process.exit(1)
}

const clues = pack.rounds.flatMap((r) => r.categories.flatMap((c) => c.clues))
const bytes = clues.reduce(
  (n, c) => n + (c.image?.base64.length ?? 0) + (c.revealImage?.base64.length ?? 0),
  0,
)
console.log(
  `\n✓ ${pack.slug} — ${clues.length} klør, ` +
    `${clues.filter((c) => c.image).length} bilder ` +
    `(+${clues.filter((c) => c.revealImage).length} fasitbilder), ` +
    `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB base64. Klar for publisering.`,
)
