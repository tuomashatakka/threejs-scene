// lib/app/create-app.ts
// The composition root. createApp holds no logic of its own — it wires the
// functional layers (time, state, render, lifecycle, input-consuming modules)
// into one unidirectional app shell: store -> module.update(state, frame, ctx)
// -> scene each tick; input goes back through setState()/dispatch(), never
// straight into the scene. All randomness derives from the injected seed, and
// tick() pumps the simulation manually — same seed + same tick sequence
// reproduce the exact same world.

import * as THREE from 'three'

import { createClock } from '../time/clock.js'
import { createFrameLoop } from '../time/loop.js'
import { createStore } from '../state/store.js'
import { createSeededRng } from '../state/rng.js'
import { createRenderer } from '../render/renderer.js'
import { attachResizeObserver } from '../render/resize.js'
import { disposeScene } from '../lifecycle/dispose.js'

import type { Clock, ClockOptions } from '../time/clock.js'
import type { Store, Reducer } from '../state/store.js'
import type { RendererOptions } from '../render/renderer.js'
import type { ResizeHandler } from '../render/resize.js'
import type { AppModule, ModuleHandle } from './module.js'
import type { Disposable, FrameContext, SceneContext, Vec3 } from '../types.js'


/**
 * Perspective-camera setup for {@link createApp}. Defaults: `fov` 50,
 * `near` 0.1, `far` 200, `position` [4, 3, 6], `lookAt` the origin.
 */
export interface AppCameraOptions {
  fov?:      number
  near?:     number
  far?:      number
  position?: Vec3
  lookAt?:   Vec3
}

/** Scene setup for {@link createApp}. */
export interface AppSceneOptions {

  /** @defaultValue '#0a0a14' */
  background?: THREE.ColorRepresentation
}

/** Loop setup for {@link createApp}. */
export interface AppLoopOptions {

  /**
   * Frame-rate cap (0 = uncapped). NOTE: the cap lives on the shared
   * framecapper manager, so it applies to every loop on the page.
   */
  fps?: number
}

/**
 * Configuration for {@link createApp}, grouped by concern: simulation
 * (`state`, `reducer`, `seed`, `clock`), presentation (`renderer`, `camera`,
 * `scene`), and the loop. Everything has a sensible default.
 */
export interface AppOptions<S extends object, A = Partial<S>> {

  /** Initial serializable app state. Defaults to an empty object. */
  state?: S

  /** Optional reducer enabling `app.dispatch(action)` alongside `setState`. */
  reducer?: Reducer<S, A>

  /**
   * Seed for the injected {@link SceneContext.rng}. Same seed + same tick
   * sequence reproduce the same world.
   * @defaultValue 1
   */
  seed?: number

  /** Injectable time source: clock options, or a prebuilt {@link Clock}. */
  clock?: Clock | ClockOptions

  /** Renderer factory options, or a prebuilt renderer (tests, custom setups). */
  renderer?: Omit<RendererOptions, 'canvas'> | THREE.WebGLRenderer

  /** Perspective-camera options, or a prebuilt camera (e.g. an iso ortho rig). */
  camera?: AppCameraOptions | THREE.Camera

  /** Scene options; see {@link AppSceneOptions}. */
  scene?: AppSceneOptions

  /** Loop options; see {@link AppLoopOptions}. */
  loop?: AppLoopOptions

  /**
   * Replaces the default `renderer.render(scene, camera)` — wire a composer
   * here. Receives the frame context (`delta` is the real frame delta).
   */
  render?: (frame: FrameContext) => void

  /** Runs after built-in resize handling and module resize hooks. */
  onResize?: ResizeHandler

  /** Modules built at creation, in order — same contract as `app.use()`. */
  use?: AppModule<S>[]
}

/**
 * Running app shell returned by {@link createApp}. Drive it with the frame
 * loop (`start`/`stop`) or pump the simulation manually with `tick`;
 * `dispose` tears down the loop, modules, scene, and renderer.
 */
export interface App<S extends object, A = Partial<S>> extends Disposable {
  ctx:   SceneContext
  store: Store<S, A>
  getState (): S

  /** Shallow-merge `patch` into app state and notify store subscribers. */
  setState (patch: Partial<S>): void

  /** Run the reducer. Throws when the app was created without one. */
  dispatch (action: A): void

  /** Build `module` immediately and add it to the update loop. */
  use (module: AppModule<S>): ModuleHandle

  /** Advance the simulation by `realDelta` seconds (default 1/60) and render once. */
  tick (realDelta?: number): void

  /** Attach to the frame loop and animate continuously. */
  start (): void

  /** Detach from the frame loop; state and scene stay intact. */
  stop (): void

  /** Whether the frame loop is currently pumping. */
  readonly running: boolean
}

function isClock (value: Clock | ClockOptions | undefined): value is Clock {
  return typeof (value as Clock | undefined)?.advance === 'function'
}

function isRenderer (value: Omit<RendererOptions, 'canvas'> | THREE.WebGLRenderer | undefined): value is THREE.WebGLRenderer {
  return typeof (value as THREE.WebGLRenderer | undefined)?.render === 'function'
}

function isCamera (value: AppCameraOptions | THREE.Camera | undefined): value is THREE.Camera {
  return (value as THREE.Camera | undefined)?.isCamera === true
}

function resolveCamera (options: AppCameraOptions | THREE.Camera | undefined, canvas: HTMLCanvasElement): THREE.Camera {
  if (isCamera(options))
    return options

  const aspect      = canvas.clientWidth / canvas.clientHeight || 1
  const perspective = new THREE.PerspectiveCamera(
    options?.fov ?? 50,
    aspect,
    options?.near ?? 0.1,
    options?.far ?? 200,
  )
  perspective.position.set(...options?.position ?? [ 4, 3, 6 ])
  perspective.lookAt(new THREE.Vector3(...options?.lookAt ?? [ 0, 0, 0 ]))
  return perspective
}

/**
 * Build a complete unidirectional app shell: renderer, scene, camera, seeded
 * rng, store, clock, and one frame loop wired together. Each simulation tick
 * flows store state through `module.update(state, frame, ctx)` before a
 * single render; input goes back through `setState`/`dispatch`, never
 * straight into the scene.
 *
 * The loop starts paused — call `start()` to animate, or `tick()` to step
 * deterministically (headless tests, replays).
 *
 * @param canvas - Target canvas. The renderer sizes itself to the canvas parent.
 * @param options - App configuration; see {@link AppOptions}.
 * @returns An {@link App} handle. `dispose()` stops the loop, detaches the
 * resize observer, disposes modules (in reverse build order), scene, and renderer.
 * @throws Error when `canvas` is missing.
 * @typeParam S - Serializable app state shape.
 * @typeParam A - Action type for the optional reducer; defaults to `Partial<S>`.
 * @example
 * const app = createApp(canvas, {
 *   state: { speed: 1 },
 *   use:   [ standardLighting(), orbitControls() ],
 * })
 * app.use(turbineModule)
 * app.start()
 * // later: app.setState({ speed: 2 }); app.dispose()
 */
export function createApp<S extends object = Record<string, unknown>, A = Partial<S>> (
  canvas: HTMLCanvasElement,
  options: AppOptions<S, A> = {},
): App<S, A> {
  if (!canvas)
    throw new Error('createApp: canvas required')

  const {
    state = {} as S,
    reducer,
    seed = 1,
    render,
    onResize,
    use: initialModules = [],
  } = options

  const clock    = isClock(options.clock) ? options.clock : createClock(options.clock)
  const renderer = isRenderer(options.renderer) ? options.renderer : createRenderer({ canvas, ...options.renderer })

  const scene      = new THREE.Scene()
  scene.background = new THREE.Color(options.scene?.background ?? '#0a0a14')

  const camera = resolveCamera(options.camera, canvas)
  const store  = createStore<S, A>(state, reducer)
  const rng    = createSeededRng(seed)
  const loop   = createFrameLoop({ fps: options.loop?.fps })

  const ctx: SceneContext = { scene, camera, renderer, rng, loop }

  // modules — built immediately, updated in insertion order
  const active: AppModule<S>[] = []

  function mountModule (module: AppModule<S>): ModuleHandle {
    module.build(ctx)
    active.push(module)
    return {
      name: module.name,
      remove () {
        const index = active.indexOf(module)
        if (index >= 0)
          active.splice(index, 1)
        module.dispose?.()
      },
    }
  }

  const detachResize = attachResizeObserver(renderer, camera, canvas, (width, height) => {
    const size = { width, height }
    for (const module of active)
      module.resize?.(size, ctx)
    onResize?.(width, height)
  })

  for (const module of initialModules)
    mountModule(module)

  // pre-warm shaders so the first frame doesn't stall
  renderer.compile(scene, camera)

  // one simulation tick: state -> modules. Never the reverse.
  let frame = 0

  function step (delta: number): void {
    frame += 1

    const frameCtx: FrameContext = { delta, elapsed: clock.elapsed(), frame }
    const current                = store.get()
    for (const module of active)
      module.update?.(current, frameCtx, ctx)
  }

  // one pump per real frame: 0..n sim ticks, then exactly one render
  function pump (realDelta: number): void {
    for (const delta of clock.advance(realDelta))
      step(delta)
    if (render)
      render({ delta: realDelta, elapsed: clock.elapsed(), frame })
    else
      renderer.render(scene, camera)
  }

  const stopFrame = loop.onFrame(({ delta }) => pump(delta))

  return {
    ctx,
    store,
    getState: store.get,
    setState: patch => store.set(patch),
    dispatch: action => store.dispatch(action),
    use:      mountModule,
    tick (realDelta = 1 / 60) {
      pump(realDelta)
    },
    start: () => loop.start(),
    stop:  () => loop.stop(),
    get running () {
      return loop.running
    },
    dispose () {
      stopFrame()
      loop.dispose()
      detachResize()
      for (const module of [ ...active ].reverse())
        module.dispose?.()
      active.length = 0
      disposeScene(scene)
      renderer.dispose()
    },
  }
}

// perf: cheap scaffolding — one rAF, one Set iteration, one render per frame.
// Fixed-clock mode may run 0..maxSubSteps sim ticks per pump but still renders once.
