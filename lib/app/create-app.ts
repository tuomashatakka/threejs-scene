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
import { createModuleRuntime } from './runtime.js'
import { flattenPlugins } from './plugin.js'
import { resolveStrict, violationOf } from './strict.js'

import type { Clock, ClockOptions } from '../time/clock.js'
import type { Store, Reducer } from '../state/store.js'
import type { RendererOptions } from '../render/renderer.js'
import type { ResizeHandler } from '../render/resize.js'
import type { AnyAppModule, AppModule, ModuleHandle } from './module.js'
import type { Capability } from './capability.js'
import type { PluginInput } from './plugin.js'
import type { ModuleRuntime } from './runtime.js'
import type { ModuleViolation, StrictOptions } from './strict.js'
import type { Disposable, FrameContext, SceneContext, Size, Vec3 } from '../types.js'


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
   * Takes precedence over any module's `render` hook (see {@link AppModule.render});
   * prefer a pluggable module (e.g. `postProcessing()`) unless you need a
   * one-off override at the composition root.
   */
  render?: (frame: FrameContext) => void

  /** Runs after built-in resize handling and module resize hooks. */
  onResize?: ResizeHandler

  /** Modules built at creation, in order — same contract as `app.use()`. */
  use?: AnyAppModule<S>[]

  /**
   * Plugin bundles, flattened ahead of `use`. A plugin is a named group of
   * modules that only make sense together; see {@link definePlugin}.
   */
  plugins?: readonly PluginInput<S>[]

  /**
   * Contract enforcement. On by default unless `NODE_ENV` is `'production'`:
   * modules are watched for nondeterminism, out-of-scope scene writes, state
   * mutation, per-tick allocation, and undeclared capability use. Pass `false`
   * to switch it off, or an object to tune it; see {@link StrictOptions}.
   */
  strict?: StrictOptions | boolean

  /**
   * Receives every contract violation instead of the default console reporter.
   * Shorthand for `strict: { report }`.
   */
  onViolation?: (violation: ModuleViolation) => void
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
  use<R> (module: AppModule<S, R>): ModuleHandle

  /** Build every module of a plugin bundle, in order. */
  usePlugin (plugin: PluginInput<S>): ModuleHandle[]

  /** Read a capability published by a mounted module. Throws when absent. */
  resolve<T> (token: Capability<T>): T

  /** Read a capability published by a mounted module, or `null`. */
  tryResolve<T> (token: Capability<T>): T | null

  /** Mounted module ids in resolved order — providers before consumers. */
  readonly modules: readonly string[]

  /** Every contract violation reported so far. Empty is the goal. */
  readonly violations: readonly ModuleViolation[]

  /** The module graph and lifecycle pump, for editors and test harnesses. */
  readonly runtime: ModuleRuntime<S, A>

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

  const strict = resolveStrict(
    options.onViolation
      ? { ...typeof options.strict === 'boolean' ? { enabled: options.strict } : options.strict, report: options.onViolation }
      : options.strict,
  )

  // the app-level context. Modules receive a ModuleContext — a superset of this
  // scoped to one module — never this object; `loop` in particular is the app's
  // to drive, which is why a module's copy of it refuses subscribers (SC001).
  const ctx: SceneContext = { scene, camera, renderer, rng, loop }

  let size: Size = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 }

  const runtime = createModuleRuntime<S, A>({
    scene,
    camera,
    renderer,
    rng,
    loop,
    store,
    strict,
    size: () => size,
  })

  const detachResize = attachResizeObserver(renderer, camera, canvas, (width, height) => {
    size = { width, height }
    runtime.resize(size)
    onResize?.(width, height)
  })

  for (const module of [ ...flattenPlugins(options.plugins), ...initialModules ])
    runtime.mount(module)

  // every module has built — capabilities are resolvable from here on
  runtime.start()

  // pre-warm shaders so the first frame doesn't stall
  renderer.compile(scene, camera)

  // one simulation tick: state -> modules. Never the reverse.
  let frame = 0

  function step (delta: number): void {
    frame += 1
    runtime.update({ delta, elapsed: clock.elapsed(), frame })
  }

  // one pump per real frame: 0..n sim ticks, then exactly one render.
  // Draw path priority: the AppOptions.render override, else the claiming
  // module's render hook (post-processing composer), else the plain scene render.
  function pump (realDelta: number): void {
    for (const delta of clock.advance(realDelta))
      step(delta)

    const frameCtx: FrameContext = { delta: realDelta, elapsed: clock.elapsed(), frame }

    if (render)
      render(frameCtx)
    else if (!runtime.render(frameCtx))
      renderer.render(scene, camera)
  }

  const stopFrame = loop.onFrame(({ delta }) => pump(delta))

  /**
   * The only way app state changes. A write from inside a lifecycle hook is a
   * unidirectional-flow break (SC006) — it would let one module see a world the
   * module beside it never saw — so it is reported and dropped rather than
   * silently applied halfway through a tick.
   */
  function guardWrite (what: string): boolean {
    if (!runtime.inLifecycle)
      return true

    runtime.report(violationOf(
      'SC006',
      'app',
      runtime.phase ?? 'app',
      `${what} was called from inside a lifecycle hook; use ctx.commit so the write lands at the tick boundary`,
    ))
    return false
  }

  let disposed = false

  return {
    ctx,
    store,
    getState: store.get,

    setState (patch) {
      if (guardWrite('setState'))
        store.set(patch)
    },

    dispatch (action) {
      if (guardWrite('dispatch'))
        store.dispatch(action)
    },

    use: module => runtime.mount(module),

    usePlugin (plugin) {
      return flattenPlugins([ plugin ]).map(module => runtime.mount(module))
    },

    resolve:    token => runtime.resolve(token),
    tryResolve: token => runtime.tryResolve(token),

    get modules () {
      return runtime.order.map(entry => entry.id)
    },
    get violations () {
      return runtime.violations
    },
    runtime,

    tick (realDelta = 1 / 60) {
      pump(realDelta)
    },

    start: () => loop.start(),
    stop:  () => loop.stop(),

    get running () {
      return loop.running
    },

    dispose () {
      if (disposed)
        return

      disposed = true
      stopFrame()
      loop.dispose()
      detachResize()
      runtime.stop()
      runtime.dispose()
      disposeScene(scene)
      renderer.dispose()
    },
  }
}

// perf: cheap scaffolding — one rAF, one Set iteration, one render per frame.
// Fixed-clock mode may run 0..maxSubSteps sim ticks per pump but still renders once.
