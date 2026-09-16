// lib/app/runtime.ts
// The module runtime — everything createApp used to do inline, extracted so
// the data flow is one thing you can read in one place.
//
// What it guarantees, in the order the guarantees matter:
//
//   scoped        every module gets a root Group, an rng forked from its own
//                 id, a state slice, an ownership ledger, and a teardown that
//                 is the exact inverse of its build.
//   unidirectional  update reads a frozen slice and writes the scene; a write
//                 back to state goes on a queue that is drained after every
//                 module has updated, in module order then emission order.
//   deterministic   mount order is a pure function of the module list — a
//                 stable topological sort over declared capabilities — and the
//                 rng fork label is the module id, so adding a module cannot
//                 reshuffle the ones beside it.

import * as THREE from 'three'

import { disposeScene } from '../lifecycle/dispose.js'
import { RuleSeverity } from '../llm/rules.js'
import { capabilityName } from './capability.js'
import { ModulePhase } from './module.js'
import { createNondeterminismTrap, deepFreeze, violationOf } from './strict.js'

import type { Capability, CapabilityRef } from './capability.js'
import type { AppModule, ModuleContext, ModuleHandle, OwnedResource, StateScope } from './module.js'
import type { ModuleViolation, StrictConfig } from './strict.js'
import type { Store } from '../state/store.js'
import type { FrameContext, FrameLoop, SceneContext, SeededRng, Size } from '../types.js'


/** One queued write, drained at the tick boundary in module then emission order. */
interface QueuedWrite<S extends object, A> {

  /** State key to merge into, or `null` for a top-level patch. */
  at: keyof S & string | null

  patch?:  Partial<S> | Record<string, unknown>
  action?: A
}

/** A module as the runtime holds it: the literal plus everything scoped to it. */
export interface MountedModule<S extends object = Record<string, unknown>> {
  readonly id:     string
  readonly module: AppModule<S, unknown>
  readonly ctx:    ModuleContext<S, unknown>
  readonly root:   THREE.Group

  /** Mount sequence number — the tie-break that keeps ordering stable. */
  readonly index: number

  /** Projection from app state to this module's view. */
  readonly select: (state: S) => unknown

  /** Objects this module put straight on the scene instead of on its root. */
  readonly adopted: THREE.Object3D[]

  readonly owned:    OwnedResource[]
  readonly cleanups: (() => void)[]

  mounted:      boolean
  started:      boolean
  childBase:    number
  growthStreak: number
  reported:     Set<string>
}

/** Everything the runtime needs from the app shell around it. */
export interface ModuleRuntimeOptions<S extends object, A> {
  scene:    THREE.Scene
  camera:   THREE.Camera
  renderer: THREE.WebGLRenderer
  rng:      SeededRng
  loop:     FrameLoop
  store:    Store<S, A>
  strict:   StrictConfig

  /** Current viewport, read lazily so a module always sees the live size. */
  size (): Size
}

/**
 * The mounted-module graph and the lifecycle pump over it. Created by
 * {@link createApp}; exported because a custom shell (an editor, a test
 * harness, a second renderer) needs the same guarantees.
 */
export interface ModuleRuntime<S extends object = Record<string, unknown>, A = Partial<S>> {

  /** Build a module, attach its root, and splice it into the resolved order. */
  mount<R> (module: AppModule<S, R>): ModuleHandle

  /** Run the `start` phase for everything mounted so far. Idempotent. */
  start (): void

  /** One simulation tick: select, update, then drain the write queue. */
  update (frame: FrameContext): void

  /** Fan a viewport change out to every module, then drain. */
  resize (size: Size): void

  /** Let the claiming module draw. Returns `false` when nothing claimed. */
  render (frame: FrameContext): boolean

  /** Run the `stop` phase, newest module first. Idempotent. */
  stop (): void

  /** Tear every module down in reverse resolved order. Idempotent. */
  dispose (): void

  /** Modules in resolved order — providers before consumers. */
  readonly order: readonly MountedModule<S>[]

  /** Every violation reported so far, oldest first. */
  readonly violations: readonly ModuleViolation[]

  /** Whether a lifecycle hook is on the stack (used to catch state writes). */
  readonly inLifecycle: boolean

  /** The phase currently running, or `null`. */
  readonly phase: ModulePhase | 'mount' | null

  /** Read a published capability. Throws when nothing provides it. */
  resolve<T> (token: Capability<T>): T

  /** Read a published capability, or `null`. */
  tryResolve<T> (token: Capability<T>): T | null

  /** Report a violation through the configured reporter. */
  report (violation: ModuleViolation): void
}

function refs (list: readonly CapabilityRef[] | undefined): string[] {
  return (list ?? []).map(capabilityName)
}

function isDisposable (value: OwnedResource): value is { dispose (): void } {
  return typeof (value as { dispose?: unknown }).dispose === 'function'
}

function isObject3D (value: OwnedResource): value is THREE.Object3D {
  return (value as THREE.Object3D).isObject3D === true
}

/**
 * Resolved run order: a stable topological sort of `list` where every provider
 * precedes its consumers.
 *
 * Stability is the point. The base sequence is the coarse `order` band and then
 * mount index, and a node is only pulled forward when a dependency demands it —
 * so a module list with no declared dependencies runs in exactly the order it
 * was written, and one with dependencies runs in the only order that satisfies
 * them. Same list in, same order out, every time.
 *
 * @param list - Mounted modules in mount order.
 * @param onCycle - Called with the modules in an unsatisfiable cycle.
 * @returns The resolved order.
 */
export function resolveOrder<S extends object> (
  list: readonly MountedModule<S>[],
  onCycle?: (stuck: MountedModule<S>) => void,
): MountedModule<S>[] {
  const base = [ ...list ].sort((a, b) =>
    (a.module.order ?? 0) - (b.module.order ?? 0) || a.index - b.index)

  const providers = new Map<string, MountedModule<S>>()

  for (const entry of base)
    for (const name of refs(entry.module.provides))
      if (!providers.has(name))
        providers.set(name, entry)

  const emitted                 = new Set<MountedModule<S>>()
  const out: MountedModule<S>[] = []
  const pending                 = [ ...base ]

  const ready = (entry: MountedModule<S>): boolean =>
    [ ...refs(entry.module.requires), ...refs(entry.module.optional) ].every(name => {
      const provider = providers.get(name)
      return !provider || provider === entry || emitted.has(provider)
    })

  while (pending.length > 0) {
    const index = pending.findIndex(ready)
    const pick  = pending.splice(index >= 0 ? index : 0, 1)[0]!

    if (index < 0)
      onCycle?.(pick)

    out.push(pick)
    emitted.add(pick)
  }

  return out
}

/**
 * Create the module runtime. One per app.
 *
 * @param options - The scene, store, and strict config to run against.
 * @returns A {@link ModuleRuntime}.
 * @typeParam S - Serializable app state shape.
 * @typeParam A - Reducer action type.
 */
export function createModuleRuntime<S extends object = Record<string, unknown>, A = Partial<S>> (
  options: ModuleRuntimeOptions<S, A>,
): ModuleRuntime<S, A> {
  const { scene, camera, renderer, rng, loop, store, strict } = options

  const mounted: MountedModule<S>[]   = []
  const provided                      = new Map<string, { value: unknown, by: string }>()
  const violations: ModuleViolation[] = []
  const queue: QueuedWrite<S, A>[]    = []
  const trap                          = createNondeterminismTrap()

  let order: MountedModule<S>[]           = []
  let claim: MountedModule<S> | null      = null
  let sequence                            = 0
  let depth                               = 0
  let phase: ModulePhase | 'mount' | null = null
  let appStarted                          = false
  let disposed                            = false
  let instrument                          = false

  function report (violation: ModuleViolation): void {
    violations.push(violation)
    strict.report(violation)

    if (strict.throwOnViolation && violation.severity === RuleSeverity.Error)
      throw new Error(violation.message)
  }

  function flag (
    entry: MountedModule<S> | null,
    key: string,
    detail: string,
    at?: string,
    once = true,
  ): void {
    const id = entry?.id ?? 'app'

    if (once && entry) {
      if (entry.reported.has(key))
        return
      entry.reported.add(key)
    }

    report(violationOf(key, id, phase ?? 'app', detail, at))
  }

  // ---- ordering ------------------------------------------------------------

  function reorder (): void {
    order = resolveOrder(mounted, stuck =>
      flag(stuck, 'SC009', 'is in an unsatisfiable capability cycle; mount order fell back to insertion order'))

    claim = null
    for (const entry of order)
      if (entry.module.render)
        claim = entry

    if (!strict.enabled)
      return

    const claimants = order.filter(entry => entry.module.render)

    if (claimants.length > 1)
      flag(claim, 'SC011', `${claimants.length} modules claim the draw (${claimants.map(c => c.id).join(', ')}); only ${claim?.id ?? 'none'} runs`)
  }

  // ---- guarded lifecycle calls ---------------------------------------------

  function call (entry: MountedModule<S> | null, next: ModulePhase | 'mount', body: () => unknown): void {
    const previousPhase = phase
    phase = next
    depth += 1

    const watch  = strict.enabled && (instrument || next !== ModulePhase.Update && next !== ModulePhase.Render)
    const disarm = watch
      ? trap.arm((api, at) => flag(entry, 'SC002', `called ${api} during ${next}`, at, false), strict.samples)
      : null

    try {
      const result = body()

      if (strict.enabled && typeof (result as { then?: unknown } | undefined)?.then === 'function')
        flag(entry, 'SC017', `returned a promise from ${next}; the runtime does not await lifecycle hooks`)
    }
    finally {
      disarm?.()
      depth -= 1
      phase = previousPhase
    }
  }

  // ---- the write queue -----------------------------------------------------

  function enqueue (write: QueuedWrite<S, A>): void {
    queue.push(write)
  }

  /**
   * Apply the queue. Contiguous patches merge into one store commit so a tick
   * notifies subscribers once rather than once per module; an action breaks the
   * run because the reducer must see the patches before it.
   */
  function drain (): void {
    if (queue.length === 0)
      return

    const writes                        = queue.splice(0, queue.length)
    let batch: Record<string, unknown> | null = null

    const flush = (): void => {
      if (batch) {
        store.set(batch as Partial<S>)
        batch = null
      }
    }

    for (const write of writes) {
      if (write.action !== undefined) {
        flush()
        store.dispatch(write.action)
        continue
      }

      const next: Record<string, unknown> = batch ?? {}

      if (write.at === null)
        Object.assign(next, write.patch)
      else {
        const held     = batch?.[write.at] ?? (store.get() as Record<string, unknown>)[write.at]
        next[write.at] = { ...held as object, ...write.patch }
      }

      batch = next
    }

    flush()
  }

  // ---- capabilities --------------------------------------------------------

  function tryResolve<T> (token: Capability<T>): T | null {
    const found = provided.get(capabilityName(token))
    return found ? found.value as T : null
  }

  function resolve<T> (token: Capability<T>): T {
    const found = tryResolve(token)

    if (found === null)
      throw new Error(`threejs-scene: no module provides the '${capabilityName(token)}' capability`)

    return found
  }

  // ---- the per-module context ---------------------------------------------

  function guardedLoop (entry: MountedModule<S>): FrameLoop {
    return {
      onFrame () {
        flag(entry, 'SC001', 'subscribed to the frame loop directly; animate in update instead')
        return () => {}
      },
      start () {
        flag(entry, 'SC001', 'started the frame loop from inside a module')
      },
      stop () {
        flag(entry, 'SC001', 'stopped the frame loop from inside a module')
      },
      dispose () {
        flag(entry, 'SC001', 'disposed the frame loop from inside a module')
      },
      get running () {
        return loop.running
      },
    }
  }

  function makeContext (entry: MountedModule<S>, scopeAt: keyof S & string | null): ModuleContext<S, unknown> {
    const declared = new Set([ ...refs(entry.module.provides) ])
    const readable = new Set([ ...refs(entry.module.requires), ...refs(entry.module.optional) ])

    return {
      // SceneContext — the genuinely app-wide handles stay reachable
      scene,
      camera,
      renderer,
      loop: strict.enabled ? guardedLoop(entry) : loop,

      // scoped
      rng:    rng.fork(entry.id),
      id:     entry.id,
      name:   entry.module.name,
      root:   entry.root,
      strict: strict.enabled,

      get size () {
        return options.size()
      },

      own (resource) {
        entry.owned.push(resource)
        return resource
      },

      onCleanup (cleanup) {
        entry.cleanups.push(cleanup)
      },

      commit (patch) {
        if (!scopeAt) {
          flag(entry, 'SC007', 'called ctx.commit without a declared state scope; the patch was dropped')
          return
        }

        enqueue({ at: scopeAt, patch: patch as Record<string, unknown> })
      },

      dispatch (action) {
        enqueue({ at: null, action: action as A })
      },

      provide (token, value) {
        const name = capabilityName(token)

        if (strict.enabled && !declared.has(name))
          flag(entry, 'SC010', `provided the undeclared capability '${name}'; add it to provides: []`)

        const existing = provided.get(name)

        if (existing && existing.by !== entry.id)
          flag(entry, 'SC010', `overwrote the '${name}' capability already provided by ${existing.by}`)

        provided.set(name, { value, by: entry.id })
      },

      resolve (token) {
        const name = capabilityName(token)

        if (strict.enabled && !readable.has(name))
          flag(entry, 'SC009', `resolved the undeclared capability '${name}'; add it to requires: [] or optional: []`)

        return resolve(token)
      },

      tryResolve (token) {
        const name = capabilityName(token)

        if (strict.enabled && !readable.has(name))
          flag(entry, 'SC009', `resolved the undeclared capability '${name}'; add it to optional: []`)

        return tryResolve(token)
      },

      violation (rule, message) {
        flag(entry, rule, message, undefined, false)
      },

      get violations () {
        return violations
      },
    }
  }

  // ---- mount / unmount -----------------------------------------------------

  function uniqueId (name: string): string {
    if (!mounted.some(entry => entry.id === name))
      return name

    let suffix = 2
    while (mounted.some(entry => entry.id === `${name}#${suffix}`))
      suffix += 1

    return `${name}#${suffix}`
  }

  function mount<R> (module: AppModule<S, R>): ModuleHandle {
    if (disposed)
      throw new Error('threejs-scene: cannot mount a module on a disposed app')

    if (!module?.name || typeof module.build !== 'function')
      throw new Error('threejs-scene: a module needs a name and a build function')

    const id   = uniqueId(module.name)
    const root = new THREE.Group()

    root.name              = id
    root.userData.moduleId = id

    const scopeAt = (module.scope as StateScope<S, keyof S & string> | undefined)?.at ?? null

    const entry: MountedModule<S> = {
      id,
      module:       module as unknown as AppModule<S, unknown>,
      root,
      index:        sequence++,
      adopted:      [],
      owned:        [],
      cleanups:     [],
      mounted:      true,
      started:      false,
      childBase:    0,
      growthStreak: 0,
      reported:     new Set(),
      select:       scopeAt
        ? state => (state as Record<string, unknown>)[scopeAt]
        : module.select as ((state: S) => unknown) | undefined ?? (state => state),
      ctx: null as unknown as ModuleContext<S, unknown>,
    }

    Object.assign(entry, { ctx: makeContext(entry, scopeAt) })

    if (id !== module.name)
      flag(entry, 'SC016', `is the second module named '${module.name}'; it mounted as '${id}' with its own rng stream`)

    // a scoped module's key exists before it builds, so build can read it
    if (scopeAt !== null && (store.get() as Record<string, unknown>)[scopeAt] === undefined)
      store.set({ [scopeAt]: (module.scope as StateScope<S, keyof S & string>).initial } as Partial<S>)

    mounted.push(entry)
    scene.add(root)

    if (module.setup)
      call(entry, ModulePhase.Setup, () => module.setup!())

    const before = strict.enabled ? new Set(scene.children) : null

    call(entry, ModulePhase.Build, () => module.build(entry.ctx as ModuleContext<S, R>))

    // objects put straight on the scene are still torn down with the module —
    // ownership is not optional — but say so, because they are outside its root.
    if (before)
      for (const child of scene.children)
        if (child !== root && !before.has(child)) {
          entry.adopted.push(child)
          flag(entry, 'SC004', `added ${child.type} '${child.name || 'unnamed'}' straight to the scene; build into ctx.root`)
        }

    if (strict.enabled)
      for (const name of refs(module.provides))
        if (!provided.has(name))
          flag(entry, 'SC010', `declared the '${name}' capability but never called ctx.provide for it`)

    entry.childBase = root.children.length
    reorder()

    if (appStarted)
      startOne(entry)

    drain()
    return handleFor(entry)
  }

  function startOne (entry: MountedModule<S>): void {
    if (entry.started || !entry.mounted)
      return

    entry.started = true

    if (strict.enabled)
      for (const name of refs(entry.module.requires))
        if (!provided.has(name))
          flag(entry, 'SC009', `requires the '${name}' capability and no mounted module provides it`)

    if (entry.module.start)
      call(entry, ModulePhase.Start, () => entry.module.start!(entry.ctx))
  }

  function teardown (entry: MountedModule<S>): void {
    if (!entry.mounted)
      return

    entry.mounted = false

    const index = mounted.indexOf(entry)
    if (index >= 0)
      mounted.splice(index, 1)

    for (const [ name, held ] of provided)
      if (held.by === entry.id)
        provided.delete(name)

    if (entry.started && entry.module.stop)
      call(entry, ModulePhase.Stop, () => entry.module.stop!(entry.ctx))

    call(entry, ModulePhase.Dispose, () => entry.module.dispose?.())

    for (const cleanup of [ ...entry.cleanups ].reverse())
      call(entry, ModulePhase.Dispose, cleanup)

    for (const resource of [ ...entry.owned ].reverse())
      call(entry, ModulePhase.Dispose, () => {
        if (typeof resource === 'function')
          resource()
        else if (isObject3D(resource)) {
          disposeScene(resource)
          resource.removeFromParent()
        }
        else if (isDisposable(resource))
          resource.dispose()
      })

    for (const stray of [ ...entry.adopted ].reverse()) {
      disposeScene(stray)
      stray.removeFromParent()
    }

    disposeScene(entry.root)
    entry.root.clear()
    entry.root.removeFromParent()

    entry.cleanups.length = 0
    entry.owned.length    = 0
    entry.adopted.length  = 0
    reorder()
  }

  function handleFor (entry: MountedModule<S>): ModuleHandle {
    return {
      id:   entry.id,
      name: entry.module.name,
      root: entry.root,
      get mounted () {
        return entry.mounted
      },
      remove () {
        teardown(entry)
      },
    }
  }

  // ---- the pump ------------------------------------------------------------

  function checkGrowth (entry: MountedModule<S>): void {
    const now = entry.root.children.length

    if (now > entry.childBase) {
      entry.growthStreak += 1
      entry.childBase     = now

      if (entry.growthStreak >= 3)
        flag(entry, 'SC012', `added a child to its root on ${entry.growthStreak} consecutive ticks; build objects once and reuse them`)
    }
    else {
      entry.growthStreak = 0
      entry.childBase    = now
    }
  }

  return {
    mount,

    start () {
      appStarted = true
      for (const entry of [ ...order ])
        startOne(entry)
      drain()
    },

    update (frame) {
      instrument = strict.enabled && frame.frame <= strict.frames

      const state = strict.enabled ? deepFreeze(store.get()) : store.get()

      for (const entry of [ ...order ]) {
        if (!entry.mounted || !entry.module.update)
          continue

        const view = entry.select(state)

        call(entry, ModulePhase.Update, () => entry.module.update!(view, frame, entry.ctx))

        if (instrument)
          checkGrowth(entry)
      }

      instrument = false
      drain()
    },

    resize (size) {
      for (const entry of [ ...order ]) {
        if (!entry.mounted || !entry.module.resize)
          continue

        call(entry, ModulePhase.Resize, () => entry.module.resize!(size, entry.ctx))
      }
      drain()
    },

    render (frame) {
      if (!claim?.mounted || !claim.module.render)
        return false

      const owner = claim
      instrument  = strict.enabled && frame.frame <= strict.frames
      call(owner, ModulePhase.Render, () => owner.module.render!(frame, owner.ctx))
      instrument  = false
      return true
    },

    stop () {
      for (const entry of [ ...order ].reverse()) {
        if (!entry.started || !entry.module.stop)
          continue

        entry.started = false
        call(entry, ModulePhase.Stop, () => entry.module.stop!(entry.ctx))
      }
    },

    dispose () {
      if (disposed)
        return

      disposed = true
      for (const entry of [ ...order ].reverse())
        teardown(entry)

      mounted.length = 0
      order          = []
      claim          = null
      queue.length   = 0
      provided.clear()
      trap.reset()
    },

    get order () {
      return order
    },
    get violations () {
      return violations
    },
    get inLifecycle () {
      return depth > 0
    },
    get phase () {
      return phase
    },
    resolve,
    tryResolve,
    report,
  }
}
