# threejs-scene — instructions for coding agents

Vanilla three.js, imperative, deterministic. **Not** react-three-fiber: there is no JSX, no
`useFrame`, no reconciler. `createApp` owns the only frame loop in the page, and everything you
build is an `AppModule` mounted into it.

Two things models get wrong about this package before anything else:

1. **You never call `requestAnimationFrame`.** Animation goes in `update(view, frame, ctx)`, which
   the app calls with the frame delta already computed. A second loop is rule `SC001`.
2. **Modules do not write app state.** They read a slice and write the *scene*. To change state,
   `ctx.commit(patch)`, which the runtime applies at the tick boundary. That is rule `SC006`.

## Read order

| you need | read |
| --- | --- |
| a real signature | `node_modules/threejs-scene/llms.txt` — generated from the built `.d.ts`, so it cannot drift |
| how to compose it | this file |
| what modules exist | `llm/modules.json`, or `npx threejs-scene modules`, or `listModules()` at runtime |
| the rules in full | `llm/RULES.md`, or `npx threejs-scene rules SC004` |
| a specialised agent | `llm/agents/*.md`, installable with `npx threejs-scene agents install` |

Never guess a signature. `llms.txt` is generated from the exact version installed.

## The contract, in full

```ts
import { defineModule } from 'threejs-scene'

const turbine = defineModule<State>({
  name:     'turbine',        // unique; also the rng fork label, so keep it meaningful
  order:    0,                // coarse band, applied before the dependency sort
  provides: [ TurbineRig ],   // capabilities this module publishes with ctx.provide
  requires: [ Physics ],      // capabilities it resolves; providers are ordered before it
  optional: [ Quality ],      // ordered first when present, never required
  select:   state => state.turbine,   // pure projection: what update() reads

  setup ()                  {},  // declare only. No scene, no state, no allocation
  build (ctx)               {},  // create ONCE, into ctx.root, through ctx.own
  start (ctx)               {},  // every module has built — ctx.resolve peers here
  update (view, frame, ctx) {},  // project the slice onto the scene; ctx.commit to write back
  resize (size, ctx)        {},  // viewport changed
  render (frame, ctx)       {},  // optional: claims the frame draw
  stop (ctx)                {},  // detaching from the loop
  dispose ()                {},  // only for what ctx.own could not cover
})
```

Only `name` and `build` are required.

`ctx` is a `ModuleContext`. It is a superset of `SceneContext` — `scene`, `camera`, `renderer`
are still there, because some things genuinely are app-wide (environment maps, raycasting, pixel
ratio) — plus everything that makes the module's data flow scoped:

| member | what it is |
| --- | --- |
| `ctx.root` | a `THREE.Group` attached to the scene at mount, detached and disposed at teardown |
| `ctx.rng` | a `SeededRng` **already forked by module id** — fork again per feature |
| `ctx.own(resource)` | register for automatic disposal in reverse order; returns the resource |
| `ctx.onCleanup(fn)` | run `fn` at teardown, after `dispose` and before the owned resources |
| `ctx.commit(patch)` | queue a state write; applied at the tick boundary. Needs a declared scope |
| `ctx.dispatch(action)` | queue a reducer action, drained with the commits |
| `ctx.provide(token, value)` | publish a capability declared in `provides` |
| `ctx.resolve(token)` | read a peer's capability. Throws when nothing provides it |
| `ctx.tryResolve(token)` | the same, returning `null` instead of throwing |
| `ctx.size` | the current viewport, live |
| `ctx.id` / `ctx.name` | instance id (`lighting`, or `lighting#2`) and declared name |
| `ctx.strict` | whether contract enforcement is on |
| `ctx.violations` | every violation reported so far — read it from a diagnostics module |
| `ctx.violation(rule, msg)` | report one yourself |

And the app around it:

```ts
const app = createApp<State>(canvas, {
  state:   { speed: 1 },      // serializable. Tuples, not Vector3s
  seed:    1,                 // same seed + same ticks = same world
  loop:    { fps: 0 },        // ALWAYS pass this — the cap is page-global (SC013)
  plugins: [ isometricKit() ],
  use:     [ standardLighting(), turbine ],
  strict:  true,              // default on outside NODE_ENV=production
})

app.start()                   // attach to the frame loop
app.tick(1 / 60)              // or step deterministically instead (headless)
app.use(module)               // -> ModuleHandle { id, name, root, mounted, remove() }
app.usePlugin(plugin)         // -> ModuleHandle[]
app.resolve(CameraRig)        // read a capability from outside a module
app.modules                   // ids in resolved order
app.violations                // contract breaches. Empty is the goal
app.setState({ speed: 2 })    // from OUTSIDE a lifecycle hook only
app.dispose()                 // loop, modules (reverse), scene, renderer
```

## The three properties, and the mechanism behind each

### Scoped

A module owns a subtree, a random stream, a state key, and a ledger — nothing else, and nothing
else owns those.

- `ctx.root` is attached at mount and, at teardown, `disposeScene`d, cleared and detached. You do
  not write teardown for the objects under it.
- `ctx.own(x)` takes anything with a `dispose()`, any `Object3D`, or a plain teardown function, and
  releases it **in reverse order** at teardown. `ctx.own` returns its argument, so it composes
  inline: `ctx.root.add(ctx.own(new THREE.Mesh(geometry, material)))`.
- `ctx.rng` is `appRng.fork(moduleId)`. Adding a module cannot reshuffle the ones beside it.
- Objects added straight to `ctx.scene` are still adopted and torn down with the module — ownership
  is not optional — but strict mode says so, because they are outside the root you can reason about
  (`SC004`).

### Unidirectional

State flows down; intent flows back through a queue.

```
store ──select──▶ update(view, frame, ctx) ──▶ scene
                        │
                    ctx.commit
                        ▼
                    queue ──drained after every module has updated──▶ store
```

Every module in a tick sees the *same* state object. A commit never lands mid-tick, so no module
ever observes a world another module half-changed, and the same tick sequence replays identically.
Contiguous commits are merged into one store write, so a tick notifies subscribers once rather than
once per module.

In strict mode the view is deep-frozen, so `state.speed += 1` throws rather than silently
diverging. `app.setState` called from inside a hook is reported and dropped, not applied.

### Deterministic

Mount order is a pure function of the module list: a stable topological sort over declared
capabilities, tie-broken by `order` band and then insertion index. A list with no declarations runs
in exactly the order you wrote it; a list with declarations runs in the only order that satisfies
them. Same list in, same order out.

Combined with the fixed clock and the forked rng: same seed plus same tick sequence reproduces the
same world, headless included. `auditModule()` proves it by running two lifecycles and comparing
fingerprints.

## The rules

Seventeen rules, codes `SC001`–`SC017`. A rule is here only if breaking it produces code that
compiles, runs, and is still wrong. Full text with rationale in `llm/RULES.md`.

| code | id | rule | severity |
| --- | --- | --- | --- |
| SC001 | single-frame-loop | createApp owns the only frame loop | error |
| SC002 | no-nondeterminism | randomness from `ctx.rng`, time from `frame` | error |
| SC003 | fork-rng-by-name | fork the rng per consumer, by label | warn |
| SC004 | scoped-root | build into `ctx.root`, never straight into `ctx.scene` | error |
| SC005 | own-your-resources | route every GPU allocation through `ctx.own` | error |
| SC006 | no-state-write-in-update | never write app state from inside a lifecycle hook | error |
| SC007 | commit-needs-scope | only a module that owns a state key may commit | error |
| SC008 | pure-select | `select` is a pure, cheap projection | warn |
| SC009 | declare-dependencies | resolve only what you declared | error |
| SC010 | provide-what-you-declare | publish every capability you declare, during build | error |
| SC011 | single-render-claim | one render hook wins — know which | warn |
| SC012 | build-once | generate in `build`, animate in `update` | error |
| SC013 | explicit-fps | always pass `loop.fps`, including `0` | warn |
| SC014 | dom-free-assets | keep `modules/assets` DOM-free and SSR-safe | error |
| SC015 | mark-shared-resources | mark pooled resources shared before disposing a tree | error |
| SC016 | unique-module-name | module names are unique and stable | error |
| SC017 | sync-lifecycle | lifecycle hooks are synchronous | error |

Three things enforce them:

- **strict mode**, on by default outside `NODE_ENV=production`. It traps `Math.random`/`Date.now`/
  `performance.now` during lifecycle calls (attributing the call site, and ignoring three.js's own
  uuid generation), deep-freezes the state view, diffs the scene after build, counts root growth
  across ticks, and checks every declared capability was actually provided.
- **the ESLint plugin**, `threejs-scene/eslint`. Same ids, same codes, before the code runs.
- **`auditModule()`** from `threejs-scene/testing`, which runs the whole lifecycle twice.

## Recipes

### A minimal lit scene

```ts
import { createApp } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'

const app = createApp(canvas, {
  seed: 1,
  loop: { fps: 0 },
  use:  [ standardLighting(), orbitControls({ radius: [ 3, 40 ] }) ],
})

app.start()
```

### A module that owns objects

A module is a factory closing over what it built. Do not reach for `this` — the literal is data,
and the closure is where per-instance state belongs.

```ts
import * as THREE from 'three'
import { defineModule } from 'threejs-scene'

interface State { speed: number }

export function turbine () {
  let blades: THREE.Group

  return defineModule<State>({
    name: 'turbine',

    build (ctx) {
      // own() everything that touches the GPU; root scopes it to this module
      const geometry = ctx.own(new THREE.BoxGeometry(0.2, 2, 0.05))
      const material = ctx.own(new THREE.MeshStandardMaterial({ color: '#c8d2e0' }))

      blades = ctx.own(new THREE.Group())

      const jitter = ctx.rng.fork('blades')     // fork per feature, not per draw

      for (let index = 0; index < 3; index++) {
        const blade = new THREE.Mesh(geometry, material)

        blade.rotation.z = index / 3 * Math.PI * 2 + jitter.range(-0.02, 0.02)
        blades.add(blade)
      }

      ctx.root.add(blades)
    },

    update (state, frame) {
      // animate from the frame, never from a clock
      blades.rotation.z += state.speed * frame.delta
    },
  })
}
```

### A module with its own state

A module that writes state declares the key it owns. Then its reads and its writes are the same
key, and two modules can never collide.

```ts
import { defineScopedModule } from 'threejs-scene'

interface Weather { rain: number }
interface State { weather: Weather }

const weather = defineScopedModule<State, 'weather'>('weather', { rain: 0 }, {
  name: 'weather',

  build (ctx) { /* … */ },

  update (weather, frame, ctx) {
    // queued, applied after every module has updated this tick
    ctx.commit({ rain: Math.min(1, weather.rain + frame.delta * 0.1) })
  },
})
```

Without a scope, `ctx.commit` is refused (`SC007`). A module that only reads uses `select`.

### Two modules talking

```ts
import { capability, defineModule } from 'threejs-scene'

interface TurbineApi { setSpeed (rpm: number): void }
export const Turbine = capability<TurbineApi>('turbine')

const engine = defineModule({
  name:     'engine',
  provides: [ Turbine ],
  build (ctx) {
    ctx.provide(Turbine, { setSpeed: rpm => { /* … */ } })
  },
})

const governor = defineModule({
  name:     'governor',
  requires: [ Turbine ],           // the runtime orders `engine` before this
  build:    () => {},
  start (ctx) {
    ctx.resolve(Turbine).setSpeed(1200)   // guaranteed to exist
  },
})
```

Use `optional: [ Token ]` plus `ctx.tryResolve` when the peer may not be mounted — that is how a
heavy module sizes itself to `Quality` without requiring a quality governor.

### A post-processing chain

`postProcessing()` declares `order: 100` and a `render` hook, so it claims the draw wherever you
put it in `use: []`.

```ts
import { postProcessing } from 'threejs-scene/modules/post'
import { createChromaticAberration } from 'threejs-scene/modules/post/webgl'

postProcessing({
  bloom:   { strength: 0.8 },
  depth:   true,                    // needed by DOF, god rays, motion blur
  effects: () => [ createChromaticAberration({ strength: 1.2 }) ],
  onFrame: frame => grade.setTime(frame.elapsed),
})
```

### A deterministic headless test

```ts
import { describe, expect, it } from 'vitest'
import { auditModule, headlessApp } from 'threejs-scene/testing'

describe('turbine', () => {
  it('honours the module contract', () => {
    const audit = auditModule(turbine, { seed: 7 })

    expect(audit.report).toBe('')      // violations, leaks, stranded children
    expect(audit.deterministic).toBe(true)
  })

  it('spins at the state speed', () => {
    const app    = headlessApp({ state: { speed: 2 } })
    const handle = app.use(turbine())

    app.tick(1 / 60)
    expect(handle.root.children[0].rotation.z).toBeCloseTo(2 / 60)
    expect(app.violations).toEqual([])
    app.dispose()
  })
})
```

`auditModule` mounts the module twice, ticks it, resizes it, tears it down, and reports: strict-mode
violations, GPU resources never disposed, objects stranded on the scene, and any difference between
the two runs from the same seed. Pass a factory, not a module instance, when the module keeps
closure state — which is almost always.

## Composition

**Ordering.** Declared capabilities decide it. `order` is a coarse band for the few modules that
genuinely bracket the rest — the built-ins use `input -200`, `quality -150`, `persistence -175`,
`diagnostics -250`, `camera -75`, `lighting -50`, `assets -60`, `physics -25`, `post +100`. Leave
it at `0` unless you know why you are moving it.

**Plugins** are named bundles, flattened ahead of `use`:

```ts
import { definePlugin } from 'threejs-scene'

export const isometricKit = () => definePlugin({
  name: 'isometric-kit',
  use:  [ cameraRig({ kind: 'iso' }), pointerInput(), standardLighting() ],
})
```

**The draw** goes to `AppOptions.render` if set, else the last module in resolved order with a
`render` hook, else `renderer.render(scene, camera)`. Two composers mounted together is not an
error — it is one composer silently never drawing (`SC011`).

**Import paths.** Everything ships ESM and CJS.

| need | path |
| --- | --- |
| app shell, loop, store, camera, input, diagnostics | `threejs-scene` |
| geometry, materials, textures, props | `threejs-scene/modules/assets` |
| every built-in module in one import | `threejs-scene/modules/all` |
| lighting / orbit / camera / input / quality / diagnostics / persistence | `threejs-scene/modules/<name>` |
| a post chain / one pass | `threejs-scene/modules/post` · `threejs-scene/modules/post/webgl` |
| rigid bodies, cloth, liquid | `threejs-scene/modules/physics` (peer: `cannon-es`) |
| the contract test kit | `threejs-scene/testing` |
| rules and catalogue as data | `threejs-scene/llm` |
| the ESLint plugin | `threejs-scene/eslint` |

## Checking your own work

Before you say a change is done:

```sh
npm run typecheck && npm run lint && npm run test
```

And for anything that touches a module:

- `app.violations` is empty after a few ticks.
- `auditModule(yourModuleFactory).ok` is `true`.
- `handle.remove()` leaves `handle.root.children` empty and `handle.root.parent` null.
- Two runs with the same seed produce the same `snapshotObject(handle.root)`.

## If you are about to…

| symptom | rule | what to do instead |
| --- | --- | --- |
| reach for `requestAnimationFrame` | SC001 | animate in `update`, using `frame.delta` |
| reach for `Math.random()` | SC002 | `ctx.rng.fork('label').range(a, b)` |
| reach for `Date.now()` for animation | SC002 | `frame.elapsed` |
| call `ctx.scene.add(mesh)` | SC004 | `ctx.root.add(mesh)` |
| create a texture or geometry in `build` | SC005 | wrap it in `ctx.own(...)` |
| assign to the state you were handed | SC006 | `ctx.commit({ field: next })` |
| call `ctx.commit` and see it dropped | SC007 | use `defineScopedModule(at, initial, …)` |
| call `ctx.resolve` and get an error | SC009 | add the token to `requires: []` |
| allocate inside `update` | SC012 | hoist it to `build` and mutate in place |
| write `async build` | SC017 | load first, then `app.use(moduleFor(loaded))` |
| see a scene that differs between runs | SC002/SC003 | `auditModule()` will name the module |
| see one composer never drawing | SC011 | only one module may claim `render` |
