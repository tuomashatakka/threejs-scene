// modules/quality/index.ts
// The device-quality ladder as a module.
//
// The signals (`readQualitySignals`) and the memory (`createLadderMemory`) have
// always been in the library, and deliberately do not pick a budget: that
// mapping is the app's. What was missing is the thing that turns them into a
// decision every frame — measure, compare against the tier's frame budget,
// step down when the device cannot hold it, and remember the verdict so the
// next load does not have to re-learn the same crash.
//
// It is a module because the decision has to happen inside a tick, in one
// place, with everybody else reading the result rather than each measuring for
// themselves.

import {
  Quality,
  createLadderMemory,
  defineScopedModule,
  readQualitySignals,
  registerModule,
} from '../../lib/index.js'

import type { AppModule, QualityApi, QualityTier } from '../../lib/index.js'


/** The default ladder: three rungs that map onto the usual budget decisions. */
export const DEFAULT_TIERS: readonly QualityTier[] = [
  { name: 'low', level: 0, budget: { shadowMapSize: 512, pixelRatio: 1, post: false, instances: 200 }},
  { name: 'medium', level: 1, budget: { shadowMapSize: 1024, pixelRatio: 1.5, post: true, instances: 800 }},
  { name: 'high', level: 2, budget: { shadowMapSize: 2048, pixelRatio: 2, post: true, instances: 3000 }},
]

/** The slice {@link qualityGovernor} owns when `at` is set. */
export interface QualitySlice {

  /** The name of the tier in force. */
  tier: string

  /** Smoothed frame time in milliseconds. */
  frameMs: number
}

/** Options for {@link qualityGovernor}. */
export interface QualityGovernorOptions {

  /** The rungs, cheapest first. @defaultValue {@link DEFAULT_TIERS} */
  tiers?: readonly QualityTier[]

  /**
   * Which rung to start on, by name. Omit to pick from the device signals:
   * a coarse pointer or fewer than four cores starts low, a wide viewport with
   * eight or more cores starts high, everything else starts in the middle.
   */
  start?: string

  /**
   * Frame-time ceiling in milliseconds. Sustained frames slower than this drop
   * a rung. @defaultValue 20 (≈50fps, one rung of headroom under 60)
   */
  budgetMs?: number

  /**
   * How many consecutive over-budget ticks it takes to drop. Raise it if your
   * scene has legitimate hitches — a shader compile is not a slow device.
   * @defaultValue 45
   */
  patience?: number

  /**
   * Storage key for the ladder memory, so a tier that crashed once is not
   * offered again. Omit to skip persistence.
   */
  memoryKey?: string

  /** Build token for the memory; a verdict is only about the code that earned it. */
  build?: string

  /** Mirror the tier into app state under this key. */
  at?: string
}

function pickStart (tiers: readonly QualityTier[]): QualityTier {
  const signals = readQualitySignals()

  if (signals.coarsePointer || signals.hardwareConcurrency < 4)
    return tiers[0]!

  if (signals.wideViewport && signals.hardwareConcurrency >= 8)
    return tiers[tiers.length - 1]!

  return tiers[Math.floor((tiers.length - 1) / 2)]!
}

/**
 * A quality governor as an {@link AppModule}, publishing the {@link Quality}
 * capability: the tier in force, the ladder, a way to ask for a downgrade, and
 * a change subscription.
 *
 * It only ever steps *down*. Climbing back up after a hitch produces a scene
 * that oscillates between two looks, which reads worse than the cheaper one
 * held steadily.
 *
 * @param options - See {@link QualityGovernorOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @example
 * const app = createApp(canvas, {
 *   loop: { fps: 0 },
 *   use:  [ qualityGovernor({ memoryKey: 'scene-quality', build: __BUILD_SHA__ }) ],
 * })
 *
 * app.use(defineModule({
 *   name:     'trees',
 *   optional: [ Quality ],
 *   build (ctx) {
 *     const count = Number(ctx.tryResolve(Quality)?.tier.budget.instances ?? 800)
 *     ctx.root.add(ctx.own(scatterTrees(count, ctx.rng.fork('trees'))))
 *   },
 * }))
 */
export function qualityGovernor<S extends object = Record<string, unknown>> (
  options: QualityGovernorOptions = {},
): AppModule<S> {
  const tiers    = options.tiers ?? DEFAULT_TIERS
  const budgetMs = options.budgetMs ?? 20
  const patience = options.patience ?? 45
  const names    = tiers.map(tier => tier.name)

  const memory = options.memoryKey
    ? createLadderMemory({ ladder: names, key: options.memoryKey, build: options.build })
    : null

  const listeners = new Set<(tier: QualityTier) => void>()

  let current  = tiers[0]!
  let overRun  = 0
  let smoothed = 1000 / 60

  function tierNamed (name: string): QualityTier {
    return tiers.find(tier => tier.name === name) ?? tiers[0]!
  }

  function settle (next: QualityTier, why: string, commit?: (patch: Partial<QualitySlice>) => void): void {
    if (next === current)
      return

    current = next
    memory?.remember(next.name)
    commit?.({ tier: next.name })

    for (const listener of listeners)
      listener(next)

    void why
  }

  const body = {
    provides: [ Quality ],

    // decided before anything sizes itself to it
    order: -150,

    build (ctx: Parameters<AppModule<S>['build']>[0]) {
      const start = options.start ? tierNamed(options.start) : pickStart(tiers)

      current = memory ? tierNamed(memory.clamp(start.name)) : start

      ctx.provide(Quality, {
        get tier () {
          return current
        },
        tiers,
        requestDowngrade (reason: string) {
          const lower = tiers[Math.max(0, current.level - 1)]!
          settle(lower, reason)
        },
        onChange (listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      } satisfies QualityApi)

      ctx.onCleanup(() => listeners.clear())
    },
  }

  if (!options.at)
    return { name: 'quality', ...body, update: makeUpdate() } as unknown as AppModule<S>

  return defineScopedModule<Record<string, unknown>, string>(
    options.at,
    { tier: tiers[0]!.name, frameMs: 1000 / 60 } satisfies QualitySlice,
    { name: 'quality', ...body, update: makeUpdate(true) } as never,
  ) as unknown as AppModule<S>

  /**
   * The per-tick measurement. Exponential smoothing on frame time, a counter on
   * consecutive over-budget ticks, and a single step down when it runs out.
   *
   * @param scoped - Whether to mirror the measurement into the owned state key.
   * @returns The `update` hook.
   */
  type FrameType = { delta: number }

  type CtxType = { commit (patch: never): void }

  function makeUpdate (scoped = false) {
    return function update (_view: unknown, frame: FrameType, ctx: CtxType): void {
      smoothed += (frame.delta * 1000 - smoothed) * 0.1

      if (smoothed > budgetMs && current.level > 0) {
        overRun += 1

        if (overRun >= patience) {
          overRun = 0
          settle(
            tiers[current.level - 1]!,
            `frame time held above ${budgetMs}ms for ${patience} ticks`,
            scoped ? ctx.commit as unknown as (patch: Partial<QualitySlice>) => void : undefined,
          )
        }
      }
      else
        overRun = 0

      if (scoped && frame.delta > 0)
        (ctx.commit as unknown as (patch: Partial<QualitySlice>) => void)({ frameMs: Math.round(smoothed * 10) / 10 })
    }
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'quality',
  title: 'Quality governor',
  summary:
    'Picks a quality tier from device signals, measures frame time, steps down when the device cannot hold the ' +
    'budget, and remembers the verdict across loads. Publishes the tier so heavy modules size themselves to it ' +
    'instead of each guessing.',
  subpath:  'threejs-scene/modules/quality',
  factory:  'qualityGovernor',
  tags:     [ 'quality', 'performance' ],
  cost:     'free',
  provides: [ Quality ],
  options:  [
    { name: 'tiers', type: 'QualityTier[]', summary: 'the rungs, cheapest first', default: 'DEFAULT_TIERS (low/medium/high)' },
    { name: 'start', type: 'string', summary: 'starting rung by name; omit to pick from device signals' },
    { name: 'budgetMs', type: 'number', summary: 'frame-time ceiling; sustained frames slower than this drop a rung', default: '20' },
    { name: 'patience', type: 'number', summary: 'consecutive over-budget ticks before dropping', default: '45' },
    { name: 'memoryKey', type: 'string', summary: 'storage key so a tier that crashed once is not offered again' },
    { name: 'at', type: 'string', summary: 'mirror the tier and frame time into app state under this key' },
  ],
  create: (options?: QualityGovernorOptions) => qualityGovernor(options),
})

// perf: free. one multiply-add per tick.
