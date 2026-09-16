// modules/diagnostics/index.ts
// The instrumentation that answers "it works everywhere except on one device",
// as a module you mount rather than a checklist you remember.
//
// Two unrelated failures share that symptom and neither reports itself. A
// program that will not link is still bound to every draw, so the driver raises
// INVALID_OPERATION until it takes the context away — it looks thermal, and it
// is not. And a scene that quietly broke its own contract (a module allocating
// per tick, a texture never freed) degrades over minutes rather than failing, so
// nobody attributes it to the change that caused it.
//
// Mounting this module puts both on the record at start, and keeps a rolling
// picture of the frame cost while it runs.

import { capability, registerModule, reportPrograms } from '../../lib/index.js'

import type { AppModule, ModuleViolation } from '../../lib/index.js'


/** A frame-cost sample, as of the tick it was taken. */
export interface DiagnosticsSample {

  /** Draw calls in the last rendered frame. */
  calls: number

  /** Triangles in the last rendered frame. */
  triangles: number

  /** Live geometries held by the renderer. */
  geometries: number

  /** Live textures held by the renderer. */
  textures: number

  /** Linked programs. */
  programs: number

  /** Smoothed frame time in milliseconds. */
  frameMs: number
}

/** What the diagnostics module publishes. */
export interface DiagnosticsApi {

  /** The most recent sample. */
  readonly sample: DiagnosticsSample

  /** Contract violations reported so far, newest last. */
  readonly violations: readonly ModuleViolation[]

  /**
   * Whether the program audit said to stop before drawing. `true` means at
   * least one shader refused to link and drawing will kill the context.
   */
  readonly halt: boolean

  /** A one-screen summary, for a HUD or a bug report. */
  describe (): string
}

/** Renderer and contract diagnostics, for a HUD, a test, or a bug report. */
export const Diagnostics = capability<DiagnosticsApi>('diagnostics')

/** Options for {@link diagnostics}. */
export interface DiagnosticsOptions {

  /**
   * Run the program link audit at start. Needs a real WebGL context, so it is
   * skipped automatically when the renderer cannot produce one.
   * @defaultValue true
   */
  audit?: boolean

  /**
   * Where audit lines go.
   * @defaultValue `console.info` for notes and `console.error` for faults
   */
  report?: { say (line: string): void, fail (line: string): void }

  /** Ticks between samples. Sampling is cheap but not free. @defaultValue 30 */
  every?: number

  /** Called with each new sample — feed a HUD, or a telemetry sink. */
  onSample?: (sample: DiagnosticsSample) => void
}

/**
 * Renderer and contract diagnostics as an {@link AppModule}, publishing the
 * {@link Diagnostics} capability.
 *
 * Mount it first in development and leave it out of production, or mount it
 * always and route `onSample` at your telemetry — the cost is one read of
 * `renderer.info` every `every` ticks.
 *
 * @param options - See {@link DiagnosticsOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @example
 * const app = createApp(canvas, { loop: { fps: 0 }, use: [ diagnostics() ] })
 *
 * if (!app.resolve(Diagnostics).halt)
 *   app.start()   // draws are what turn a refused program into a dead context
 */
export function diagnostics<S extends object = Record<string, unknown>> (
  options: DiagnosticsOptions = {},
): AppModule<S> {
  const every = options.every ?? 30

  const sample: DiagnosticsSample = {
    calls:      0,
    triangles:  0,
    geometries: 0,
    textures:   0,
    programs:   0,
    frameMs:    1000 / 60,
  }

  let halt = false

  return {
    name:     'diagnostics',
    provides: [ Diagnostics ],

    // first in, so a refused program is on the record before anything draws
    order: -250,

    build (ctx) {
      ctx.provide(Diagnostics, {
        get sample () {
          return sample
        },
        get violations () {
          return ctx.violations
        },
        get halt () {
          return halt
        },
        describe () {
          return [
            `draws ${sample.calls} · tris ${sample.triangles}`,
            `geometries ${sample.geometries} · textures ${sample.textures} · programs ${sample.programs}`,
            `frame ${sample.frameMs.toFixed(1)}ms`,
            halt ? 'HALT: a program refused to link — do not start the loop' : 'programs linked',
            ctx.violations.length ? `${ctx.violations.length} contract violation(s)` : 'no contract violations',
          ].join('\n')
        },
      } satisfies DiagnosticsApi)
    },

    start (ctx) {
      if (options.audit === false)
        return

      // the audit reads the live GL context; a stub renderer has none, and a
      // headless test is not the place this failure happens anyway
      const gl = ctx.renderer.getContext?.() as WebGL2RenderingContext | null | undefined

      if (!gl)
        return

      const report = options.report ?? {
        say:  (line: string) => console.info(`threejs-scene: ${line}`),
        fail: (line: string) => console.error(`threejs-scene: ${line}`),
      }

      halt = reportPrograms(ctx.renderer, report, false)
    },

    update (_view, frame, ctx) {
      sample.frameMs += (frame.delta * 1000 - sample.frameMs) * 0.1

      if (frame.frame % every !== 0)
        return

      const info = ctx.renderer.info

      sample.calls      = info.render?.calls ?? 0
      sample.triangles  = info.render?.triangles ?? 0
      sample.geometries = info.memory?.geometries ?? 0
      sample.textures   = info.memory?.textures ?? 0
      sample.programs   = info.programs?.length ?? 0

      options.onSample?.(sample)
    },
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'diagnostics',
  title: 'Renderer diagnostics',
  summary:
    'Audits shader program linking at start (a program that will not link kills the context on the first draw, ' +
    'and looks thermal) and samples draw calls, memory and frame time while the app runs.',
  subpath:  'threejs-scene/modules/diagnostics',
  factory:  'diagnostics',
  tags:     [ 'diagnostics', 'performance' ],
  cost:     'free',
  provides: [ Diagnostics ],
  options:  [
    { name: 'audit', type: 'boolean', summary: 'run the program link audit at start; skipped when there is no GL context', default: 'true' },
    { name: 'every', type: 'number', summary: 'ticks between renderer.info samples', default: '30' },
    { name: 'onSample', type: '(sample: DiagnosticsSample) => void', summary: 'feed a HUD or a telemetry sink' },
  ],
  create: (options?: DiagnosticsOptions) => diagnostics(options),
})

// perf: free. one renderer.info read every `every` ticks.
