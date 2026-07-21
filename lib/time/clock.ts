// lib/time/clock.ts
// Injectable simulation time source. 'wall' passes real frame deltas through
// untouched; 'fixed' runs a fixed-timestep accumulator so the same tick
// sequence always produces the same simulation — the determinism backbone for
// replays and headless tests (same seed + same steps -> same world).

/** Time-advance strategy: `'wall'` passes real deltas through, `'fixed'` emits fixed-size steps. */
export type ClockMode = 'wall' | 'fixed'

/** Options for {@link createClock}. */
export interface ClockOptions {

  /**
   * Advance strategy; see {@link ClockMode}.
   * @defaultValue 'wall'
   */
  mode?: ClockMode

  /**
   * Fixed step size in seconds. Only used in 'fixed' mode.
   * @defaultValue 1/60
   */
  step?: number

  /**
   * Max fixed steps consumed per advance() call. Overflow time is dropped.
   * @defaultValue 5
   */
  maxSubSteps?: number
}

/**
 * A simulation time source. Feed it real elapsed seconds via `advance` and run
 * one simulation tick per returned delta. In 'fixed' mode the returned deltas
 * are always exactly `step`, so tick count — not wall time — drives the sim.
 */
export interface Clock {
  readonly mode: ClockMode
  advance (realDelta: number): readonly number[]

  /** Total simulated seconds consumed so far. */
  elapsed (): number
  reset (): void
}

/**
 * Create an injectable simulation time source. In `'wall'` mode `advance`
 * echoes the real delta back as a single tick; in `'fixed'` mode it
 * accumulates real time and emits 0..`maxSubSteps` ticks of exactly `step`
 * seconds each.
 *
 * @param options - Mode plus fixed-step tuning; see {@link ClockOptions}.
 * @returns A {@link Clock}; `reset()` zeroes the accumulator and elapsed total.
 * @remarks When more than `maxSubSteps` worth of time piles up (hidden tab, GC
 * pause), the overflow is dropped rather than replayed, so the sim slows down
 * instead of entering a catch-up death spiral. Zero allocation per frame — the
 * returned delta array is reused across `advance` calls.
 */
export function createClock ({ mode = 'wall', step = 1 / 60, maxSubSteps = 5 }: ClockOptions = {}): Clock {
  let accumulator = 0
  let total       = 0
  const out: number[] = []

  function advance (realDelta: number): readonly number[] {
    out.length = 0
    if (mode === 'wall') {
      total += realDelta
      out.push(realDelta)
      return out
    }

    // fixed: accumulate real time, emit whole steps. When more than
    // maxSubSteps worth of time has piled up the remainder is DROPPED rather
    // than replayed — the sim slows instead of entering a catch-up spiral.
    accumulator += realDelta
    while (accumulator >= step && out.length < maxSubSteps) {
      accumulator -= step
      total       += step
      out.push(step)
    }
    if (out.length >= maxSubSteps)
      accumulator = 0
    return out
  }

  return {
    mode,
    advance,
    elapsed: () => total,
    reset () {
      accumulator = 0
      total       = 0
    },
  }
}

// perf: cheap. one reused array, zero allocation per frame.
