// lib/app/module.ts
// The module contract.
//
// A module is a scene feature that handles data in exactly one direction:
// state flows *down* into it (`select` narrows the app state to the slice this
// module reads, `update` projects that slice onto objects), and intent flows
// *back up* through `ctx.commit`, which queues a patch that the runtime drains
// at the tick boundary. A module never writes the store mid-tick, so every
// module in a tick sees the same snapshot and the tick is reproducible.
//
// It is also *scoped*: everything it builds goes under `ctx.root`, everything
// it allocates goes through `ctx.own`, its randomness comes from an rng forked
// by module id (so adding a module does not reshuffle the ones after it), and
// its teardown is the exact inverse — the runtime removes the root, disposes
// what was owned, and runs the cleanups in reverse.

import type * as THREE from 'three'

import type { Capability, CapabilityRef } from './capability.js'
import type { Disposable, FrameContext, SceneContext, Size } from '../types.js'


/** The lifecycle phases, in the order the runtime runs them. */
export enum ModulePhase {

  /** Declare-only. No scene access; runs before any module builds. */
  Setup = 'setup',

  /** Create objects once, under `ctx.root`. */
  Build = 'build',

  /** Every module has built — safe to `ctx.resolve` a peer's capability. */
  Start = 'start',

  /** Project the state slice onto the objects, every simulation tick. */
  Update = 'update',

  /** React to a viewport change. */
  Resize = 'resize',

  /** Optionally claim the frame's draw. */
  Render = 'render',

  /** Detaching from the loop, before dispose. */
  Stop = 'stop',

  /** Release everything build allocated. */
  Dispose = 'dispose',
}

/** What a module may hand to `ctx.own` for scoped teardown. */
export type OwnedResource = Partial<Disposable> | THREE.Object3D | (() => void)

/**
 * The erased form of {@link StateScope}, as the module interface carries it.
 *
 * The typed form is what {@link defineScopedModule} checks; the field itself
 * stays erased so a module written against one state shape is still assignable
 * to `AnyAppModule` — a generic parameter inside an invariant property position
 * would otherwise make every heterogeneous `use: []` array a type error.
 */
export interface ModuleStateScope {

  /** The state key this module owns. */
  at: string

  /** Seeded into `state[at]` at mount when the key is absent. */
  initial: unknown
}

/**
 * A state namespace a module reads *and* writes. Declaring one is what earns a
 * module the right to `ctx.commit`: the runtime seeds `state[at]` with
 * `initial` before the module builds, hands `update` the value at `at`, and
 * merges every committed patch back into that key and nowhere else.
 *
 * @typeParam S - App state shape.
 * @typeParam K - The key this module owns.
 */
export interface StateScope<S extends object, K extends keyof S & string> extends ModuleStateScope {

  /** The state key this module owns. */
  at: K

  /** Seeded into `state[at]` at mount when the key is absent. */
  initial: S[K]
}

/** The patch type `ctx.commit` accepts for a module reading `R`. */
export type ModulePatch<R> = R extends object ? Partial<R> : never

/**
 * The per-module context. A superset of {@link SceneContext} — `scene`,
 * `camera` and `renderer` are still there for the things that genuinely are
 * app-wide (environment maps, raycasting, pixel ratio) — plus everything that
 * makes a module's data flow scoped.
 *
 * @typeParam S - App state shape.
 * @typeParam R - The slice this module reads (and, with a scope, writes).
 */
export interface ModuleContext<S extends object = Record<string, unknown>, R = S> extends SceneContext {

  /** Unique instance id. Equals `name`, or `name#2` for a second instance. */
  readonly id: string

  /** The module's declared name. */
  readonly name: string

  /**
   * This module's subtree. Add here, not to `ctx.scene`: the runtime attaches
   * it on build and, on teardown, detaches and disposes it for you.
   */
  readonly root: THREE.Group

  /** Current viewport in CSS pixels — the same value `resize` receives. */
  readonly size: Size

  /** Whether contract enforcement is on; see {@link AppModuleOptions}. */
  readonly strict: boolean

  /**
   * Take ownership of a resource so teardown is automatic. Returns the
   * resource, so it composes inline. Anything with a `dispose()`, any
   * `Object3D`, or a plain teardown function.
   *
   * @example
   * const material = ctx.own(new THREE.MeshStandardMaterial())
   */
  own<T extends OwnedResource> (resource: T): T

  /** Run `cleanup` on teardown, after `dispose` and before the owned resources. */
  onCleanup (cleanup: () => void): void

  /**
   * Queue a state patch. It is applied after every module has updated this
   * tick, in module order then emission order — never mid-tick, so no module
   * ever observes a half-applied world.
   *
   * Requires a declared {@link StateScope}: a module that only projects state
   * has nothing to write back.
   */
  commit (patch: ModulePatch<R>): void

  /** Queue a reducer action, drained with the commits. Requires a reducer. */
  dispatch (action: unknown): void

  /** Publish the value for a capability this module declared in `provides`. */
  provide<T> (token: Capability<T>, value: T): void

  /** Read a peer's capability. Throws when nothing provides it. */
  resolve<T> (token: Capability<T>): T

  /** Read a peer's capability, or `null` when nothing provides it. */
  tryResolve<T> (token: Capability<T>): T | null

  /** Report a contract violation against this module. */
  violation (rule: string, message: string): void
}

/**
 * A scene feature in the unidirectional flow.
 *
 * The required half is `name` and `build`. Everything else is opt-in, and each
 * optional hook has exactly one job:
 *
 * | hook | when | may |
 * | --- | --- | --- |
 * | `setup` | before any module builds | declare only — no scene, no state |
 * | `build` | once, at mount | create objects under `ctx.root`, `ctx.provide` |
 * | `start` | once, after every module built | `ctx.resolve` peers |
 * | `update` | every simulation tick | read the slice, write the scene, `ctx.commit` |
 * | `resize` | on viewport change | re-layout, re-frustum |
 * | `render` | per frame, if claimed | draw |
 * | `stop` | before dispose | detach |
 * | `dispose` | at teardown | release what `own` cannot |
 *
 * @typeParam S - App state shape.
 * @typeParam R - The slice `update` reads. Defaults to the whole state.
 */
export interface AppModule<S extends object = Record<string, unknown>, R = S> {

  /** Stable identifier. Also the rng fork label, so keep it meaningful. */
  name: string

  /**
   * Coarse ordering band, applied before the dependency sort. Lower runs
   * earlier. Use it for the few modules that genuinely must bracket the rest —
   * post-processing at `+100`, an input reader at `-100`.
   * @defaultValue 0
   */
  order?: number

  /** Capabilities this module publishes with `ctx.provide`. */
  provides?: readonly CapabilityRef[]

  /**
   * Capabilities this module resolves. The runtime orders providers before
   * consumers and fails the mount when one is missing, so `ctx.resolve` in
   * `start` never returns undefined.
   */
  requires?: readonly CapabilityRef[]

  /** Optional capabilities — ordered before this module when present, never required. */
  optional?: readonly CapabilityRef[]

  /**
   * The state key this module owns; see {@link StateScope}. Declaring it
   * narrows `update`'s first argument to `state[at]` and points `ctx.commit`
   * at the same key. Written by {@link defineScopedModule}, which checks the
   * key and the initial value against `S`.
   */
  scope?: ModuleStateScope

  /**
   * Pure projection of app state to the slice `update` reads. Read-only: a
   * module with a `select` but no `scope` cannot commit.
   *
   * Keep it pure and cheap — it runs once per module per tick.
   */
  select? (state: S): R

  /** Declare capabilities and dependencies. No scene or state access. */
  setup? (): void

  /** Create objects once, under `ctx.root`. */
  build (ctx: ModuleContext<S, R>): void

  /** Every module has built; resolve peers here. */
  start? (ctx: ModuleContext<S, R>): void

  /** Project the current slice onto the scene, every simulation tick. */
  update? (view: R, frame: FrameContext, ctx: ModuleContext<S, R>): void

  /** React to viewport size changes (ortho frustums, HUD layout, …). */
  resize? (size: Size, ctx: ModuleContext<S, R>): void

  /**
   * Take over the frame's draw, replacing the default
   * `renderer.render(scene, camera)` — wire an {@link https://threejs.org/docs/#examples/en/postprocessing/EffectComposer | EffectComposer}
   * here. A module that defines `render` becomes a pluggable post-processing
   * layer: drop it into `use: []` and it owns the render. When several active
   * modules define `render` the last one in resolved order wins; a top-level
   * `AppOptions.render` overrides all of them.
   */
  render? (frame: FrameContext, ctx: ModuleContext<S, R>): void

  /** Detaching from the loop; the inverse of `start`. */
  stop? (ctx: ModuleContext<S, R>): void

  /**
   * Release what `ctx.own` could not. The runtime already detaches and
   * disposes `ctx.root` and everything owned — this is for the rest.
   */
  dispose? (): void
}

/**
 * Any module, when the slice type is irrelevant — what a heterogeneous
 * `use: []` array is. `unknown` rather than `never`: the slice is a *result*
 * type, so widening it keeps every concrete module assignable.
 */
export type AnyAppModule<S extends object = Record<string, unknown>> = AppModule<S, unknown>

/** Handle returned by `app.use()`; `remove()` detaches and disposes the module. */
export interface ModuleHandle {

  /** Unique instance id — `name`, or `name#2` for a second instance. */
  readonly id: string

  readonly name: string

  /** The module's own subtree, for tests and inspection. */
  readonly root: THREE.Group

  /** Whether this module is still mounted. */
  readonly mounted: boolean

  /** Detach, dispose, and remove the module's subtree. Idempotent. */
  remove (): void
}

/**
 * Identity helper that pins the state generic and gives module literals full
 * type inference — the module-authoring entry point.
 *
 * @param module - The module literal.
 * @returns The same object, typed.
 * @typeParam S - App state shape.
 * @typeParam R - The slice `update` reads; inferred from `select`.
 * @example
 * const turbine = defineModule<State>({
 *   name: 'turbine',
 *   build (ctx) { ctx.root.add(ctx.own(new THREE.Mesh(geometry, material))) },
 *   update (state, frame, ctx) { … },
 * })
 */
export function defineModule<S extends object = Record<string, unknown>, R = S> (module: AppModule<S, R>): AppModule<S, R> {
  return module
}

/**
 * A module that owns one key of the app state: it reads `state[at]` and its
 * `ctx.commit` merges back into the same key, so its writes cannot collide
 * with any other module's.
 *
 * @param at - The state key this module owns.
 * @param initial - Seeded into `state[at]` at mount when the key is absent.
 * @param module - The module literal, minus `scope`.
 * @returns A module scoped to `at`.
 * @typeParam S - App state shape.
 * @typeParam K - The owned key.
 * @example
 * const weather = defineScopedModule<State, 'weather'>('weather', { rain: 0 }, {
 *   name:   'weather',
 *   build:  ctx => { … },
 *   update (weather, frame, ctx) {
 *     ctx.commit({ rain: Math.min(1, weather.rain + frame.delta * 0.1) })
 *   },
 * })
 */
export function defineScopedModule<S extends object, K extends keyof S & string> (
  at: K,
  initial: S[K],
  module: Omit<AppModule<S, S[K]>, 'scope'>,
): AppModule<S, S[K]> {
  return { ...module, scope: { at, initial } satisfies StateScope<S, K> } as AppModule<S, S[K]>
}
