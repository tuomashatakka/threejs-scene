// lib/app/strict.ts
// Contract enforcement. The rules in lib/llm/rules.ts are only rules if
// something checks them, and the checks that matter are the ones a type system
// cannot make: a module that reaches for Math.random inside build, a module
// that mutates the state it was handed, a module that keeps adding meshes every
// tick. All of it is off in production and on everywhere else.
//
// Instrumentation is sampled rather than continuous: every phase that runs once
// (setup, build, start, resize, dispose) is watched in full, and the per-tick
// phases are watched only for the first few frames — long enough to catch the
// mistake, short enough to stay out of the frame budget.

import { RuleSeverity, findRule, ruleMessage } from '../llm/rules.js'

import type { ModulePhase } from './module.js'


/** One breach of the contract, reported against the module that caused it. */
export interface ModuleViolation {

  /** Rule code, e.g. `SC004`. */
  code: string

  /** Rule kebab id, e.g. `scoped-root`. */
  id: string

  severity: RuleSeverity

  /** Module instance id, or `'app'` for app-level breaches. */
  module: string

  /** The phase it happened in. */
  phase: ModulePhase | 'mount' | 'app'

  /** Human-readable, already formatted by {@link ruleMessage}. */
  message: string

  /** Best-effort call site, when one could be attributed. */
  at?: string
}

/** Receives every violation. Return nothing; throwing aborts the phase. */
export type ViolationReporter = (violation: ModuleViolation) => void

/** Strict-mode tuning; see {@link AppOptions.strict}. */
export interface StrictOptions {

  /**
   * Master switch. Defaults to on unless `process.env.NODE_ENV` is
   * `'production'`.
   */
  enabled?: boolean

  /**
   * How many leading frames to instrument the per-tick phases for. The
   * mistakes this catches are structural, so they show up on frame 1.
   * @defaultValue 8
   */
  frames?: number

  /** Stack samples taken per phase invocation. @defaultValue 4 */
  samples?: number

  /** Throw on an error-severity violation instead of reporting it. @defaultValue false */
  throwOnViolation?: boolean

  /** Where violations go. @defaultValue a `console.warn`/`console.error` reporter */
  report?: ViolationReporter
}

/** Resolved {@link StrictOptions} with every default filled in. */
export interface StrictConfig {
  enabled:          boolean
  frames:           number
  samples:          number
  throwOnViolation: boolean
  report:           ViolationReporter
}

function productionLike (): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> }}).process?.env
  return env?.NODE_ENV === 'production'
}

/** Default reporter: warnings to `console.warn`, errors to `console.error`. */
export function consoleReporter (violation: ModuleViolation): void {
  const line = `threejs-scene: ${violation.message}${violation.at ? `\n    at ${violation.at}` : ''}`

  if (violation.severity === RuleSeverity.Error)
    console.error(line)
  else
    console.warn(line)
}

/**
 * Fill in every {@link StrictOptions} default. `true`/`false` are shorthand for
 * `{ enabled }`.
 *
 * @param options - User-supplied strict settings, or a bare boolean.
 * @returns A fully resolved {@link StrictConfig}.
 */
export function resolveStrict (options: StrictOptions | boolean | undefined): StrictConfig {
  const given: StrictOptions = typeof options === 'boolean' ? { enabled: options } : options ?? {}

  return {
    enabled:          given.enabled ?? !productionLike(),
    frames:           given.frames ?? 8,
    samples:          given.samples ?? 4,
    throwOnViolation: given.throwOnViolation ?? false,
    report:           given.report ?? consoleReporter,
  }
}

const THREE_FRAME = /node_modules[\\/]three[\\/]|[\\/]three\.(?:module|core|cjs|min)\.js|three[\\/]build[\\/]/u
const OWN_FRAME   = /[\\/]lib[\\/]app[\\/]strict\./u

/**
 * Best-effort call site for the code that just called a trapped global.
 *
 * @returns The first stack frame that is neither this file nor three.js
 * internals, or `null` when the call came from inside three (`generateUUID`
 * reaches for `Math.random` on every object, and that is not the caller's
 * fault).
 */
function callSite (): string | null {
  const stack = new Error().stack

  if (!stack)
    return null

  for (const raw of stack.split('\n').slice(1)) {
    const line = raw.trim()

    if (!line.startsWith('at ') || OWN_FRAME.test(line))
      continue

    return THREE_FRAME.test(line) ? null : line.slice(3)
  }

  return null
}

/** A nondeterminism trap installed around lifecycle calls. */
export interface NondeterminismTrap {

  /** Install the trap for one phase invocation; returns the disarm function. */
  arm (onCall: (api: string, at: string) => void, samples: number): () => void

  /** Remove the trap unconditionally — used when an app disposes mid-phase. */
  reset (): void
}

/**
 * Trap the three globals that break replay: `Math.random`, `Date.now` and
 * `performance.now`. Calls made from inside three.js (uuid generation, its own
 * clock) are ignored; anything else is attributed to the module in the phase.
 *
 * Re-entrant: nested lifecycle calls share one installation and only the
 * outermost disarm restores the originals.
 *
 * @returns A {@link NondeterminismTrap}.
 */
export function createNondeterminismTrap (): NondeterminismTrap {
  const realRandom  = Math.random
  const realNow     = Date.now
  const perf        = globalThis.performance as { now (): number } | undefined
  const realPerfNow = perf?.now.bind(perf)

  let depth                                            = 0
  let budget                                           = 0
  let sink: ((api: string, at: string) => void) | null = null

  function note (api: string): void {
    if (!sink || budget <= 0)
      return

    budget -= 1

    const at = callSite()
    if (at)
      sink(api, at)
  }

  function install (): void {
    Math.random = function trappedRandom () {
      note('Math.random')
      return realRandom()
    }

    Date.now = function trappedNow () {
      note('Date.now')
      return realNow()
    }

    if (perf && realPerfNow)
      perf.now = function trappedPerfNow () {
        note('performance.now')
        return realPerfNow()
      }
  }

  function restore (): void {
    Math.random = realRandom
    Date.now    = realNow
    if (perf && realPerfNow)
      perf.now = realPerfNow
  }

  return {
    arm (onCall, samples) {
      if (depth === 0)
        install()

      depth  += 1
      budget  = samples

      const previous = sink
      sink = onCall

      return function disarm () {
        sink   = previous
        depth -= 1
        if (depth === 0)
          restore()
      }
    },
    reset () {
      if (depth > 0) {
        depth = 0
        sink  = null
        restore()
      }
    },
  }
}

const FROZEN = new WeakSet<object>()

/**
 * three.js objects mutate themselves constantly, so freezing one breaks it.
 * App state is supposed to be serializable and hold none of these — but a
 * `Vector3` parked in state should produce a rule violation later, not a dead
 * scene now.
 */
function isThreeObject (value: object): boolean {
  const probe = value as Record<string, unknown>

  return probe.isObject3D === true ||
    probe.isMaterial === true ||
    probe.isBufferGeometry === true ||
    probe.isTexture === true ||
    probe.isVector3 === true ||
    probe.isQuaternion === true ||
    probe.isMatrix4 === true ||
    probe.isColor === true
}

/**
 * Freeze a state tree so a module cannot write through the view it was handed
 * (rule `SC006`). Memoized per object, and the store commits a new object on
 * every write, so a given tree is walked exactly once.
 *
 * @param value - Any value; non-objects, and three.js objects that would break
 * when frozen, pass through untouched.
 * @returns The same value, deeply frozen when it is a plain object.
 */
export function deepFreeze<T> (value: T): T {
  if (!value || typeof value !== 'object' || FROZEN.has(value as object))
    return value

  if (isThreeObject(value as object))
    return value

  FROZEN.add(value as object)
  Object.freeze(value)

  for (const key of Object.keys(value as object))
    deepFreeze((value as Record<string, unknown>)[key])

  return value
}

/**
 * Build a violation record from a rule key.
 *
 * @param key - Rule code or kebab id.
 * @param module - Module instance id, or `'app'`.
 * @param phase - The phase it happened in.
 * @param detail - What actually happened.
 * @param at - Optional call site.
 * @returns A {@link ModuleViolation}.
 */
export function violationOf (
  key: string,
  module: string,
  phase: ModuleViolation['phase'],
  detail: string,
  at?: string,
): ModuleViolation {
  const rule = findRule(key)

  return {
    code:     rule?.code ?? key,
    id:       rule?.id ?? key,
    severity: rule?.severity ?? RuleSeverity.Error,
    module,
    phase,
    message:  ruleMessage(key, `${module}: ${detail}`),
    at,
  }
}
