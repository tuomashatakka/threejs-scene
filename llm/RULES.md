# threejs-scene — enforced rules

A rule is here only if breaking it produces code that **compiles, runs, and is still wrong**:
a scene that drifts between replays, a module that leaks a texture per remount, a state write
that lands mid-tick. Style belongs in the linter config, not here.

Three things enforce them. **Strict mode** reports them at runtime (on by default outside
`NODE_ENV=production`). The **ESLint plugin** (`threejs-scene/eslint`) catches the static shapes
before the code runs, under the same ids. **`auditModule()`** from `threejs-scene/testing` proves
the rest by running a module through two full lifecycles.

Generated from `lib/llm/rules.ts` at version 0.7.0.

| code | id | rule | severity | enforced by |
| --- | --- | --- | --- | --- |
| [`SC001`](#sc001) | single-frame-loop | createApp owns the only frame loop | error | runtime, eslint |
| [`SC002`](#sc002) | no-nondeterminism | Take randomness from ctx.rng and time from frame | error | runtime, eslint |
| [`SC003`](#sc003) | fork-rng-by-name | Fork the rng per consumer, by label | warn | eslint, review |
| [`SC004`](#sc004) | scoped-root | Build into ctx.root, never straight into ctx.scene | error | runtime, eslint, audit |
| [`SC005`](#sc005) | own-your-resources | Route every GPU allocation through ctx.own | error | runtime, audit |
| [`SC006`](#sc006) | no-state-write-in-update | Never write app state from inside a lifecycle hook | error | runtime, eslint |
| [`SC007`](#sc007) | commit-needs-scope | Only a module that owns a state key may commit | error | runtime |
| [`SC008`](#sc008) | pure-select | select is a pure, cheap projection | warn | review |
| [`SC009`](#sc009) | declare-dependencies | Resolve only what you declared in requires/optional | error | runtime |
| [`SC010`](#sc010) | provide-what-you-declare | Publish every capability you declare, during build | error | runtime |
| [`SC011`](#sc011) | single-render-claim | One render hook wins — know which | warn | runtime |
| [`SC012`](#sc012) | build-once | Generate in build, animate in update | error | runtime, audit |
| [`SC013`](#sc013) | explicit-fps | Always pass loop.fps explicitly, including 0 | warn | review |
| [`SC014`](#sc014) | dom-free-assets | Keep modules/assets DOM-free and SSR-safe | error | eslint, review |
| [`SC015`](#sc015) | mark-shared-resources | Mark pooled resources shared before disposing a tree | error | audit, review |
| [`SC016`](#sc016) | unique-module-name | Module names are unique and stable | error | runtime |
| [`SC017`](#sc017) | sync-lifecycle | Lifecycle hooks are synchronous | error | runtime, eslint |

## SC001

**single-frame-loop** — createApp owns the only frame loop

*error, enforced by runtime, eslint*

A second loop runs outside the fixed clock, so its work is not part of a tick: it sees torn state, it is invisible to `app.tick()` in a headless test, and it keeps running after `dispose`. In strict mode a module's `ctx.loop` refuses to take subscribers for exactly this reason.

```ts
// wrong
build (ctx) { ctx.loop.onFrame(() => spin()); requestAnimationFrame(tick) }

// right
update (state, frame, ctx) { spin(frame.delta) }
```

## SC002

**no-nondeterminism** — Take randomness from ctx.rng and time from frame

*error, enforced by runtime, eslint*

`Math.random`, `Date.now` and `performance.now` make the same seed and the same tick sequence produce different worlds, which turns every replay, snapshot test and bug report into a coin flip. Strict mode traps all three for the duration of a lifecycle hook.

```ts
// wrong
const x = Math.random() * 10; mesh.rotation.y = Date.now() * 0.001

// right
const x = ctx.rng.range(0, 10); mesh.rotation.y = frame.elapsed
```

## SC003

**fork-rng-by-name** — Fork the rng per consumer, by label

*warn, enforced by eslint, review*

Consumers drawing from one stream are coupled by draw order: adding a tree reshuffles every rock placed after it. A fork is derived from a label hash, so each consumer keeps its stream no matter what else exists. The runtime already forks per module id; fork again per feature.

```ts
// wrong
const height = ctx.rng.range(1, 3)   // shared stream

// right
const trees = ctx.rng.fork('trees'); const height = trees.range(1, 3)
```

## SC004

**scoped-root** — Build into ctx.root, never straight into ctx.scene

*error, enforced by runtime, eslint, audit*

The root is the module's scope: the runtime attaches it at mount, detaches and disposes it at teardown, and can hide or reorder the whole feature by touching one object. Objects added straight to the scene are adopted as a fallback, but they are no longer yours to reason about.

```ts
// wrong
build (ctx) { ctx.scene.add(mesh) }

// right
build (ctx) { ctx.root.add(mesh) }
```

## SC005

**own-your-resources** — Route every GPU allocation through ctx.own

*error, enforced by runtime, audit*

three.js never frees GPU memory for you. An owned resource is disposed in reverse order at teardown whether the module remembered or not, which is the difference between remounting a scene a hundred times and losing the context on the twelfth.

```ts
// wrong
const map = new THREE.DataTexture(data, 64, 64)   // never disposed

// right
const map = ctx.own(new THREE.DataTexture(data, 64, 64))
```

## SC006

**no-state-write-in-update** — Never write app state from inside a lifecycle hook

*error, enforced by runtime, eslint*

A store write mid-tick means the modules updated before it and the modules updated after it saw different worlds in the same tick — the tick stops being reproducible. `ctx.commit` queues the patch and the runtime drains it at the tick boundary, in module order then emission order.

```ts
// wrong
update (state) { state.speed += 1; app.setState({ speed: 2 }) }

// right
update (state, frame, ctx) { ctx.commit({ speed: state.speed + 1 }) }
```

## SC007

**commit-needs-scope** — Only a module that owns a state key may commit

*error, enforced by runtime*

Unscoped commits from several modules race for the same keys and the last drain wins, silently. `defineScopedModule(at, initial, …)` gives the module one key: it reads that key and its commits merge into that key, so two modules can never collide.

```ts
// wrong
defineModule({ name: 'hud', update: (s, f, ctx) => ctx.commit({ score: 1 }) })

// right
defineScopedModule<State, 'hud'>('hud', { score: 0 }, { name: 'hud', … })
```

## SC008

**pure-select** — select is a pure, cheap projection

*warn, enforced by review*

It runs once per module per tick, before any scene work. Allocating or reading the scene from it makes the read path a write path and puts a garbage-collection pause in the frame budget.

```ts
// wrong
select: state => ({ ...state, extras: buildExtras() })

// right
select: state => state.terrain
```

## SC009

**declare-dependencies** — Resolve only what you declared in requires/optional

*error, enforced by runtime*

The runtime orders providers before consumers using the declarations. An undeclared resolve happens to work while the mount order is lucky and breaks the day somebody reorders `use: []`.

```ts
// wrong
start (ctx) { ctx.resolve(Physics) }   // nothing declared

// right
requires: [ Physics ], start (ctx) { ctx.resolve(Physics) }
```

## SC010

**provide-what-you-declare** — Publish every capability you declare, during build

*error, enforced by runtime*

Consumers resolve in `start`, one phase after every build. A declared-but-unpublished capability turns that into an undefined at the far end of the app instead of a mount failure here.

```ts
// wrong
provides: [ CameraRig ], build () { /* forgot to provide */ }

// right
provides: [ CameraRig ], build (ctx) { ctx.provide(CameraRig, rig) }
```

## SC011

**single-render-claim** — One render hook wins — know which

*warn, enforced by runtime*

The last module in resolved order that defines `render` owns the draw, and a top-level `AppOptions.render` overrides every module. Two composers mounted together is not an error, it is one composer silently never drawing.

```ts
// wrong
use: [ postProcessing(), postProcessing() ]

// right
use: [ postProcessing({ effects }) ]   // one claim, ordered last
```

## SC012

**build-once** — Generate in build, animate in update

*error, enforced by runtime, audit*

Allocating in `update` runs at tick rate: it rebuilds buffers the GPU has already uploaded and produces a sawtooth of garbage collection that reads as a frame-rate bug. Strict mode counts objects added to the root during update and reports the growth.

```ts
// wrong
update () { root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat)) }

// right
build (ctx) { mesh = ctx.own(new THREE.Mesh(geometry, material)) }
```

## SC013

**explicit-fps** — Always pass loop.fps explicitly, including 0

*warn, enforced by review*

The cap lives on a shared page-global framecapper, so a scene that omits it inherits whatever the last scene on the page asked for — which is how one embedded demo pins a whole site to 30fps.

```ts
// wrong
createApp(canvas, { use })

// right
createApp(canvas, { loop: { fps: 0 }, use })
```

## SC014

**dom-free-assets** — Keep modules/assets DOM-free and SSR-safe

*error, enforced by eslint, review*

Textures are `DataTexture`, never a canvas, which is the only reason the asset layer runs in a headless test and inside a server render. One `document.createElement` undoes it for everybody.

```ts
// wrong
const canvas = document.createElement('canvas')

// right
new THREE.DataTexture(pixels, width, height)
```

## SC015

**mark-shared-resources** — Mark pooled resources shared before disposing a tree

*error, enforced by audit, review*

`disposeScene` frees everything it walks, pooled materials included. One kit material shared between props, disposed from one owner's teardown, blanks every other prop still using it — which reads as a rendering bug, not a lifecycle one.

```ts
// wrong
disposeScene(root)   // root holds the shared kit material

// right
material.userData.shared = true   // or dispose per module
```

## SC016

**unique-module-name** — Module names are unique and stable

*error, enforced by runtime*

The name is the rng fork label and the handle id. Two modules called `props` draw the same random stream and shadow each other in diagnostics; renaming one changes its world.

```ts
// wrong
use: [ props(), props() ]   // both named 'props'

// right
use: [ props({ name: 'trees' }), props({ name: 'rocks' }) ]
```

## SC017

**sync-lifecycle** — Lifecycle hooks are synchronous

*error, enforced by runtime, eslint*

An async hook resolves after the phase it belongs to has finished: the runtime has already started the next module, or already disposed this one. Load first, then mount the module with what you loaded.

```ts
// wrong
async build (ctx) { const gltf = await load(url); ctx.root.add(gltf.scene) }

// right
const gltf = await load(url); app.use(modelModule(gltf))
```
