// lib/state/rng.ts
// Seeded pseudo-random number generation. Same seed -> same output. The
// fork(label) API is the determinism lesson: seed once, fork a sub-stream per
// consumer, so build order and undo/redo replay never change the output.

import type { SeededRng } from '../types'


/** Tiny fast seeded PRNG: returns a `() => number` yielding uniform values in [0, 1). Same seed → same stream. */
export function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return function rng () {
    a = a + 0x6D2B79F5 >>> 0

    let t = a
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// FNV-1a string hash, used to derive a stable sub-seed from a fork label.
function hashLabel (label: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Seeded random stream with the fork-per-consumer determinism API.
 *
 * @param seed - Any integer.
 * @returns A {@link SeededRng} with `next`/`range`/`int`/`pick`/`fork`.
 * @example
 * const rng = createSeededRng(42)
 * const grass = rng.fork('grass')   // stable regardless of call order
 */
export function createSeededRng (seed: number): SeededRng {
  const seedInt = seed >>> 0
  const next    = mulberry32(seedInt)

  const rng: SeededRng = {
    next,
    range (min, max) {
      return min + next() * (max - min)
    },
    int (minInclusive, maxInclusive) {
      return Math.floor(minInclusive + next() * (maxInclusive - minInclusive + 1))
    },
    pick (items) {
      if (items.length === 0)
        throw new Error('createSeededRng.pick: empty array')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    fork (label) {
      // label-hashed sub-stream: same seed + same label -> identical stream,
      // regardless of how many siblings forked before it.
      return createSeededRng(hashLabel(label, seedInt))
    },
  }
  return rng
}

// perf: cheap. all pure functions; fork allocates one closure per consumer.
