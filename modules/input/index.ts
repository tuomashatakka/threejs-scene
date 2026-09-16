// modules/input/index.ts
// Input as a module, which is the only way input fits the flow.
//
// A pointer event arrives whenever the browser feels like it — three times
// between two ticks, or not at all — and a handler that writes the scene
// directly from that event is the classic break in the one direction this
// package cares about: the scene changes at a moment no tick owns, so two
// modules in the same tick disagree about where the pointer is, and a replay
// of the same tick sequence produces a different world.
//
// So this module does the boring thing: it accumulates events into a buffer,
// and publishes that buffer as *state as of this tick*. Gestures still arrive
// at browser speed; every reader sees the same sample.

import * as THREE from 'three'

import { PointerInput, attachPointerGesture, defineScopedModule, registerModule } from '../../lib/index.js'

import type { AppModule, PointerInputApi, PointerState } from '../../lib/index.js'


/** The shape {@link pointerInput} publishes into app state when `at` is set. */
export interface PointerStateSlice {

  /** Normalised device coordinates, -1..1 on both axes. */
  ndc: [number, number]

  /** Whether a pointer is currently down. */
  down: boolean

  /** Ticks since the last tap, or -1 when there has been none. */
  tappedAt: number
}

/** Options for {@link pointerInput}. */
export interface PointerInputOptions {

  /**
   * Mirror the pointer into app state under this key, so a reducer or a
   * subscriber outside the scene can read it. Omit to keep the pointer out of
   * state entirely — most scenes only need the capability.
   */
  at?: string

  /**
   * Gesture tuning passed through to {@link attachPointerGesture}.
   */
  gesture?: { tapThresholdMs?: number, tapMovePx?: number }
}

interface Accumulator {
  ndc:   [number, number]
  drag:  [number, number]
  wheel: number
  pinch: number
  down:  boolean
  taps:  number
}

function emptyState (): PointerState {
  return { ndc: [ 0, 0 ], drag: [ 0, 0 ], wheel: 0, pinch: 1, down: false }
}

/**
 * Build the module body shared by the scoped and unscoped forms.
 *
 * @param options - See {@link PointerInputOptions}.
 * @param onTick - Called each tick with the sampled state, for the scoped form
 * to commit from.
 * @returns The module literal, minus `name`/`scope`.
 */
function pointerModule (
  options: PointerInputOptions,
  onTick?: (sample: PointerState, taps: number, commit: (patch: Partial<PointerStateSlice>) => void) => void,
): Omit<AppModule<Record<string, unknown>, never>, 'name'> {
  const raw: Accumulator = { ndc: [ 0, 0 ], drag: [ 0, 0 ], wheel: 0, pinch: 1, down: false, taps: 0 }
  const raycaster        = new THREE.Raycaster()
  const pointerVector    = new THREE.Vector2()

  let sample: PointerState = emptyState()

  return {
    provides: [ PointerInput ],

    // input is the top of the flow: sample before anything reads it
    order: -200,

    build (ctx) {
      const element = ctx.renderer.domElement as HTMLElement

      const toNdc = (x: number, y: number): void => {
        const rect = element.getBoundingClientRect?.() ?? { left: 0, top: 0, width: ctx.size.width, height: ctx.size.height }

        raw.ndc[0] = (x - rect.left) / (rect.width || 1) * 2 - 1
        raw.ndc[1] = -((y - rect.top) / (rect.height || 1)) * 2 + 1
      }

      ctx.own(attachPointerGesture(element, {
        onPressStart (x, y) {
          raw.down = true
          toNdc(x, y)
        },
        onPressEnd () {
          raw.down = false
        },
        onDrag (dx, dy) {
          raw.drag[0] += dx
          raw.drag[1] += dy
        },
        onPinch (deltaScale) {
          raw.pinch *= deltaScale
        },
        onWheel (delta) {
          raw.wheel += delta
        },
        onHover (x, y) {
          toNdc(x, y)
        },
        onTap (x, y) {
          raw.taps += 1
          toNdc(x, y)
        },
      }, options.gesture))

      ctx.provide(PointerInput, {
        get pointer () {
          return sample
        },
        pick (root, recursive = true) {
          pointerVector.set(sample.ndc[0], sample.ndc[1])
          raycaster.setFromCamera(pointerVector, ctx.camera)
          return raycaster.intersectObject(root, recursive)
        },
      } satisfies PointerInputApi)
    },

    update (_view, _frame, ctx) {
      // one sample per tick, then the accumulator resets: a reader sees the
      // deltas that happened since it last looked, never a running total
      sample = {
        ndc:   [ raw.ndc[0], raw.ndc[1] ],
        drag:  [ raw.drag[0], raw.drag[1] ],
        wheel: raw.wheel,
        pinch: raw.pinch,
        down:  raw.down,
      }

      const taps = raw.taps

      raw.drag[0] = 0
      raw.drag[1] = 0
      raw.wheel   = 0
      raw.pinch   = 1
      raw.taps    = 0

      onTick?.(sample, taps, ctx.commit as (patch: Partial<PointerStateSlice>) => void)
    },
  }
}

/**
 * Pointer input as an {@link AppModule}, publishing the {@link PointerInput}
 * capability: normalised coordinates, per-tick drag/wheel/pinch deltas, and a
 * raycast helper that uses the app camera.
 *
 * Read it in `update`, never in an event handler — that is the whole point.
 *
 * @param options - See {@link PointerInputOptions}. Pass `at` to mirror the
 * pointer into app state as well.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @example
 * const app = createApp(canvas, { loop: { fps: 0 }, use: [ pointerInput() ] })
 *
 * app.use(defineModule({
 *   name:     'hover',
 *   requires: [ PointerInput ],
 *   build:    () => {},
 *   update (_state, _frame, ctx) {
 *     const [ hit ] = ctx.resolve(PointerInput).pick(ctx.scene)
 *     highlight(hit?.object ?? null)
 *   },
 * }))
 */
export function pointerInput<S extends object = Record<string, unknown>> (
  options: PointerInputOptions = {},
): AppModule<S> {
  if (!options.at)
    return { name: 'input', ...pointerModule(options) } as unknown as AppModule<S>

  let ticks = 0

  return defineScopedModule<Record<string, unknown>, string>(
    options.at,
    { ndc: [ 0, 0 ], down: false, tappedAt: -1 } satisfies PointerStateSlice,
    {
      name: 'input',
      ...pointerModule(options, (sample, taps, commit) => {
        ticks += 1
        commit({
          ndc:  [ sample.ndc[0], sample.ndc[1] ],
          down: sample.down,
          ...taps > 0 ? { tappedAt: ticks } : {},
        })
      }),
    } as never,
  ) as unknown as AppModule<S>
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'input',
  title: 'Pointer input',
  summary:
    'Accumulates pointer, wheel and pinch events and publishes them as state as of the current tick, with a ' +
    'camera-aware raycast helper. Read it in update; a handler that writes the scene from an event is the ' +
    'classic break in the unidirectional flow.',
  subpath:  'threejs-scene/modules/input',
  factory:  'pointerInput',
  tags:     [ 'input', 'core' ],
  cost:     'free',
  provides: [ PointerInput ],
  options:  [
    { name: 'at', type: 'string', summary: 'mirror the pointer into app state under this key; omit to keep it out of state' },
    { name: 'gesture', type: '{ tapThresholdMs?: number, tapMovePx?: number }', summary: 'tap detection thresholds', default: '{ tapThresholdMs: 250, tapMovePx: 8 }' },
  ],
  create: (options?: PointerInputOptions) => pointerInput(options),
})

// perf: free. one object allocation per tick for the sample; the raycast only
// runs when a consumer asks for it.
