// modules/assets/authoring/relations.ts
// "on": the one relation, solved numerically.
//
// This is the single highest-value thing you can add to a dialect a small model
// writes. The measured failure is metric: on Apple's CA-VQA benchmark GPT-4o
// lands ~10-12% on object-distance and object-size estimation, and every survey
// of LLM 3D authoring reaches the same conclusion — Holodeck, SceneCraft — that
// a model which cannot compute a coordinate can still state a RELATION reliably.
// So let it say "the seat rests on the legs" and do the arithmetic here, where
// arithmetic is free and exact.
//
// The relation resolves to a number before anything is built, so the compiler,
// the critic, and the spec handed back to the model all agree on where the part
// actually went.

import { FLAT_SHAPES } from './spec.js'
import { resolvePlacements } from './layout.js'

import type { NormalizedPart } from './spec.js'


/** The vertical footprint a later part can rest on. */
interface Support {

  /** Highest point of the part, including every repeat copy. */
  top: number
}

/** An issue reporter, matching the validator's. */
type Report = (path: string, message: string) => void

/**
 * Resolve every `on` relation into a real `at` y, in place.
 *
 * A part with `on: "seat"` is lifted until its base touches the top of `seat`.
 * Only `y` is solved — `x` and `z` still come from `at`, because "on" says
 * nothing about where along a surface something sits, and quietly inventing that
 * would hide a real ambiguity from the author.
 *
 * @param report - Called for a relation that cannot be resolved: an unknown
 * name, or a part that leans on something built after it.
 * @returns The same array, with resolved parts.
 * @remarks Supports are measured axis-aligned. A rotated support reports the
 * height of its *unrotated* box, which is close enough for stacking and wrong
 * for a part turned on its side — rotate the support and place by hand.
 * @example
 * // seat rests on leg tops, back rests on the seat — a chair with two numbers
 * resolveRelations([ leg, seat, back ], report)
 */
export function resolveRelations (parts: NormalizedPart[], report: Report): NormalizedPart[] {
  const supports  = new Map<string, Support>()
  const everyName = new Set(parts.map(part => part.name))

  for (const [ index, part ] of parts.entries()) {
    if (part.on) {
      const support = supports.get(part.on)

      if (!support) {
        const earlier = [ ...supports.keys() ]
        report(
          `parts[${index}].on`,
          everyName.has(part.on)
            // the part exists, just not yet: build order IS the stacking order
            ? `"${part.on}" is built after this part — move it earlier in "parts", or rest on something already built`
            : `no part named "${part.on}" comes before this one${earlier.length > 0 ? `. Earlier parts: ${earlier.join(', ')}` : ''}`,
        )
      }
      else {
        // flat shapes have no thickness to lift by; everything else rests on
        // its own half-height
        const lift = FLAT_SHAPES.includes(part.shape) ? 0 : part.size[1] / 2
        part.at    = [ part.at[0], support.top + lift, part.at[2] ]
      }
    }

    supports.set(part.name, { top: topOf(part) })
  }

  return parts
}

/** Highest point of a part, across every copy its `repeat` places. */
function topOf (part: NormalizedPart): number {
  const half = part.size[1] / 2
  let top    = -Infinity

  for (const placement of resolvePlacements(part))
    top = Math.max(top, placement.position[1] + half)

  return top
}

// perf: one pass over the parts, one placement expansion each. Author-time only.
