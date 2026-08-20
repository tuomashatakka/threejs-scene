// lib/quality/ladder.ts
// What this device has already proven about itself.
//
// A degradation ladder works — something that loses its WebGL context drops a
// step and comes back — but it re-learns the same lesson on every load, and the
// lesson costs a crash to teach. A device that dropped to the cheapest step
// yesterday has no business being handed the next one up today just because the
// signals it broadcasts have not changed; the signals were never what was wrong.
//
// So the outcome is written down, stamped with the build, so a deploy that
// changes what a step costs starts the argument again rather than inheriting a
// verdict about code that no longer exists.
//
// Memory only ever argues *downward*. Something that survived the top step last
// week may be throttled or on battery now, and a stored high-water mark would be
// a way to push a device past what it can currently hold.

import { openStorage } from '../state/storage.js'


export interface LadderMemory<T extends string> {

  /**
   * The remembered step, if this build wrote one and it still parses.
   *
   * `null` covers every way this can legitimately fail — nothing stored, a stamp
   * from another build, a value that is no longer a step name, or storage that
   * is not there at all.
   */
  readonly remembered: T | null

  /** Hold `step` down to whatever the device has already proven. */
  clamp (step: T): T

  /** Write `step` down as survivable under this build. */
  remember (step: T): void

  /** Forget the verdict — for when an explicit override asks a fresh question. */
  forget (): void
}

export interface LadderMemoryOptions<T extends string> {

  /**
   * The steps, cheapest first. Index order *is* the ordering, so
   * {@link LadderMemory.clamp} needs no comparator.
   */
  ladder: readonly T[]

  /** Storage key. Give each independent ladder its own. */
  key: string

  /**
   * A token identifying this build.
   *
   * A verdict is only about the code that earned it. Pass a commit sha, a
   * version, or a build timestamp — anything that changes when the cost of a
   * step might have. @defaultValue `'0'`
   */
  build?: string

  /** Injectable storage, for tests. @defaultValue {@link openStorage} */
  storage?: Storage | null
}

/**
 * Remember which step of a ladder this device has survived.
 *
 * @param options - See {@link LadderMemoryOptions}.
 * @returns A {@link LadderMemory}. Every method is safe with no storage at all —
 * a device that cannot remember is the device you had before this existed, which
 * was a working device.
 *
 * @example
 * const memory = createLadderMemory({
 *   ladder: [ 'minimal', 'mobile', 'desktop', 'ultra' ] as const,
 *   key:    'app.tier',
 *   build:  __BUILD_SHA__,
 * })
 *
 * const tier = memory.clamp(pickFromSignals(readQualitySignals()))
 * // …and once it has run for a while without dying:
 * memory.remember(tier)
 */
export function createLadderMemory<T extends string> (
  options: LadderMemoryOptions<T>,
): LadderMemory<T> {
  const { ladder, key } = options
  const build           = options.build ?? '0'
  const storage         = options.storage === undefined ? openStorage(key) : options.storage

  function isStep (value: string): value is T {
    return (ladder as readonly string[]).includes(value)
  }

  function read (): T | null {
    const raw = storage?.getItem(key)

    if (!raw)
      return null

    // One space, so a build token may not contain one — which a sha, a semver
    // and a timestamp all satisfy.
    const split   = raw.indexOf(' ')
    const stamped = raw.slice(0, split)
    const step    = raw.slice(split + 1)

    if (split === -1 || stamped !== build || !isStep(step))
      return null

    return step
  }

  function write (value: string | null): void {
    try {
      if (value === null)
        storage?.removeItem(key)
      else
        storage?.setItem(key, value)
    }
    catch {
      // A full quota is not worth reporting: the fallback is simply the
      // behaviour of a device with no memory, which still works.
    }
  }

  const remembered = read()

  return {
    remembered,

    clamp (step) {
      if (!remembered)
        return step

      return ladder.indexOf(step) <= ladder.indexOf(remembered) ? step : remembered
    },

    remember (step) {
      write(`${build} ${step}`)
    },

    forget () {
      write(null)
    },
  }
}

// perf: two `localStorage` calls per load, both off the frame path.
