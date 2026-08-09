import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampWager,
  maxDailyDoubleWager,
  maxFinalWager,
  playsFinal,
  scoreDelta,
  sipsForTier,
  valueForTier,
} from './scoring.ts'
import type { Tier } from './pack-schema.ts'

const DRINK_SCALE = [2, 4, 6, 8, 10]

test('tier drives value in both rounds', () => {
  assert.equal(valueForTier(1, 100), 100)
  assert.equal(valueForTier(5, 100), 500)
  // Same pack, round 2: points double.
  assert.equal(valueForTier(1, 200), 200)
  assert.equal(valueForTier(5, 200), 1000)
})

test('sips are indexed by tier - 1, across the whole scale', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((t) => sipsForTier(t as Tier, DRINK_SCALE)),
    [2, 4, 6, 8, 10],
  )
})

test('sips do not double in round 2', () => {
  // A tier-5 clue is worth 500 in round 1 and 1000 in round 2, but costs 10
  // sips either way. "Poengene dobles, slurkene gjør ikke det."
  const round1 = valueForTier(5, 100)
  const round2 = valueForTier(5, 200)
  assert.equal(round2, round1 * 2)
  assert.equal(sipsForTier(5, DRINK_SCALE), 10)
})

test('owner miss costs half, steal miss costs full', () => {
  assert.equal(scoreDelta({ kind: 'own', correct: true }, 400), 400)
  assert.equal(scoreDelta({ kind: 'own', correct: false }, 400), -200)
  assert.equal(scoreDelta({ kind: 'steal', correct: true }, 400), 400)
  assert.equal(scoreDelta({ kind: 'steal', correct: false }, 400), -400)
})

test('timeout is treated as an owner miss', () => {
  assert.equal(
    scoreDelta({ kind: 'timeout' }, 300),
    scoreDelta({ kind: 'own', correct: false }, 300),
  )
})

test('a triple stumper costs nobody points', () => {
  assert.equal(scoreDelta({ kind: 'no_steal' }, 500), 0)
})

test('halving rounds down', () => {
  assert.equal(scoreDelta({ kind: 'own', correct: false }, 25), -12)
})

test('daily double and final swing the wager both ways', () => {
  assert.equal(
    scoreDelta({ kind: 'daily_double', correct: true, wager: 700 }, 200),
    700,
  )
  assert.equal(
    scoreDelta({ kind: 'daily_double', correct: false, wager: 700 }, 200),
    -700,
  )
  assert.equal(scoreDelta({ kind: 'final', correct: true, wager: 50 }, 0), 50)
  assert.equal(scoreDelta({ kind: 'final', correct: false, wager: 50 }, 0), -50)
})

test('daily double keeps the classic floor for a team in the red', () => {
  // Below zero in round 2: may still wager up to the top clue value.
  assert.equal(maxDailyDoubleWager(-300, 200), 1000)
  // Ahead of the floor: capped at own score.
  assert.equal(maxDailyDoubleWager(2400, 200), 2400)
})

test('a team at or below zero does not play the final', () => {
  assert.equal(playsFinal(1), true)
  assert.equal(playsFinal(0), false)
  assert.equal(playsFinal(-200), false)
  assert.equal(maxFinalWager(-200), 0)
  assert.equal(maxFinalWager(900), 900)
})

test('wagers from a phone are clamped, never trusted', () => {
  assert.equal(clampWager(999999, 900), 900)
  assert.equal(clampWager(-50, 900), 0)
  assert.equal(clampWager(12.7, 900), 12)
  assert.equal(clampWager(Number.NaN, 900), 0)
  assert.equal(clampWager(Number.POSITIVE_INFINITY, 900), 0)
})
