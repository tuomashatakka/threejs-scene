# threejs-scene — architecture plan

A ground-up rewrite of the `threejs-scenes` (v3) core, built incrementally in
this repo. The API is **imperative** — `createApp` plus a small module
contract — and the initial implementation is deliberately lightweight: a few
small files per functional layer, no reactivity system, no workers, no async
paths. Declarative/JSX authoring is a possible later layer, not part of this
scope.

## What v3 got right (kept as-is)

- Unidirectional flow: one store; state flows down into the scene every tick
  via `module.update(state, frame, ctx)`, input flows back through
  `setState`/`dispatch` — never straight into scene objects.
- Determinism: injectable clock (`wall` | `fixed`), seeded rng, manual `tick()`
  pump — same seed + same tick sequence → same world. Headless tests for free.
- One shared `requestAnimationFrame` owned by
  `@tuomashatakka/canvas-loop-framecapper`'s `FrameLoopManager`; per-app
  subscriber sets on top.
- Loop starts paused; explicit `start()`.
- Serializable state (tuples, not `Vector3`s); shallow-merge `set`, optional
  reducer.
- Strict dispose chain — every GPU/DOM resource has one owner and one teardown.

## What the new interface fixes

1. **Flat 14-key options bag** mixing concerns → options grouped by concern
   (simulation / presentation / loop), `canvas` promoted to the first argument.
2. **Boolean built-ins** (`lighting: true`, `orbit: true`) with hardcoded
   tuning → gone. Lighting and orbit are ordinary modules with options,
   living in root `modules/`, wired with `use: [ … ]` like any user module.
   `createApp` special-cases nothing the module system can express.
3. **Static module list** → runtime composition: `app.use(module)` builds
   immediately, joins the loop, returns a handle with `remove()`.
4. **No module resize hook** → modules may declare `resize(size, ctx)`; the
   resize observer fans out to them after the built-in camera/renderer
   handling.
5. **Untyped render override** → `render?: (frame: FrameContext) => void`
   receives the frame context, so composer wiring gets `delta` without closure
   tricks. A module may also declare `render(frame, ctx)`: `pump` uses the
   last-mounted render-owning module in place of the default draw (the
   `AppOptions.render` override still wins over all of them). This is what makes
   `postProcessing()` a pluggable module rather than call-site wiring.
6. **Global fps-cap leak** (framecapper cap is page-wide) → surfaced honestly
   in the `loop.fps` docs; the loop adapter is the only code touching it.

Dropped from v0 to stay lightweight: lifecycle event emitter, async
`app.ready`, worker update bridges, conditional `dispatch` typing. All can
land later without breaking this surface.

## The interface

```ts
import { createApp, defineModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'

const turbine = defineModule<State>({
  name: 'turbine',
  build (ctx)                { /* create objects once, add to ctx.scene */ },
  update (state, frame, ctx) { /* project state onto objects, every sim tick */ },
  resize (size, ctx)         { /* optional */ },
  dispose ()                 { /* optional */ },
})

const app = createApp(canvas, {
  state:  { speed: 1 },                        // simulation
  reducer,                                     //   optional; enables app.dispatch
  seed:   7,
  clock:  { mode: 'fixed', step: 1 / 120 },    //   options or a Clock instance

  renderer: { antialias: true },               // presentation
  camera:   { fov: 50, position: [4, 3, 6] },  //   or a prebuilt THREE.Camera
  scene:    { background: '#0a0a14' },

  loop:   { fps: 60 },                         // page-global cap, documented

  use: [ standardLighting(), orbitControls({ radius: [2, 50] }) ],
})

const handle = app.use(turbine)                // runtime add; handle.remove() tears down
app.start()                                    // or app.tick() for deterministic stepping
app.setState({ speed: 2 })
app.dispose()
```

`canvas` is the only required thing. `createApp(canvas)` renders an empty
scene at 60fps, paused.

## Package structure

Core source in `lib/`, grouped by function; behavior modules in **root
`modules/`**. `tsc` emit to `dist/`, subpath exports, `sideEffects: false`.

```
lib/
  index.ts              // barrel: createApp, defineModule, core factories, types
  types.ts              // FrameContext, SceneContext, Disposable, Size, tuples

  time/                 // when things happen
    clock.ts            //   wall | fixed accumulator; the determinism backbone
    loop.ts             //   framecapper adapter: per-app subscribers, fps cap

  state/                // what the world is
    store.ts            //   serializable store: get/set/dispatch/subscribe
    rng.ts              //   seeded randomness

  render/               // how it reaches the screen
    renderer.ts         //   WebGLRenderer factory (color/tonemap/shadow defaults)
    resize.ts           //   ResizeObserver wiring + fan-out to modules

  camera/               // prebuilt rigs for createApp's `camera` option
    iso.ts              //   createIsoCamera / resizeIsoCamera / aimIsoCamera
                        //     (ortho true-iso|dimetric; frustum and pose move separately)
    follow.ts           //   createFollowCamera: damped chase rig; aim() re-stations it

  lifecycle/            // teardown (observability lands here later)
    dispose.ts          //   recursive scene teardown

  input/                // how intent enters the system
    pointer-gesture.ts  //   unified drag / pinch / wheel / tap / hover

  app/                  // composition root
    create-app.ts       //   createApp: composes the layers above, nothing more
    module.ts           //   defineModule + runtime handles (use/remove)

modules/                // behavior on top of the public API — every entry is a
                        //   FOLDER with an index.ts, never a loose file
  lighting/index.ts     //   standardLighting()
  orbit/index.ts        //   orbitControls() — uses lib/input/pointer-gesture
  post/                 //   post-processing: the module + the effect catalogue
    index.ts            //     postProcessing() — owns an EffectComposer via the
                        //       module render hook; pluggable like the others.
                        //       Also re-exports composer + the used passes.
    shared/glsl.ts      //     the shared GLSL kernels (fullscreen VS, hash,
                        //       chromatic, vignette, grain) — composed into each
                        //       pass so no kernel is written twice
    *.ts                //     standalone passes (grade, glitch, god-rays, …)
    webgl/              //     the WebGL effect catalogue; each effect exists once
  assets/               //   content layer: plain factories, not app modules
    prop.ts             //     Prop (a Group of meshes) + the ownership contract
    materials.ts        //     MATERIAL_PRESETS, createStandardMaterial, toon
    textures.ts         //     seeded, DOM-free procedural DataTextures
    props.ts            //     starter catalogue built on Prop
  authoring/            //   prop authoring FOR LANGUAGE MODELS — the only module
                        //     that depends on another (assets, for Prop)
    spec.ts             //     the JSON dialect: vocabulary, budgets, defaults
    shapes.ts           //     shape word -> geometry that fills its size box
    layout.ts           //     repeat (linear|radial|mirror) -> placements
    validate.ts         //     forgiving parse: repair, clamp, report
    build.ts            //     spec -> Prop, deterministic, geometry/material shared
    review.ts           //     critique the BUILT prop: floats, detached, buried
    schema.ts           //     JSON Schema, generated from the same constants
    prompt.ts           //     grammar + worked examples + the correction turn
    tool.ts             //     provider-agnostic tool def + generate/critique loop

site/                   // vite-built public site: landing (index.html), one
                        //   interactive page (app.html) that is BOTH the dev
                        //   playground and the live post-processing demo, and the
                        //   starters gallery (starters.html) whose templates are
                        //   imported twice — as modules to run, and via ?raw to
                        //   display. Imports the built package by name (dist).
  templates/            //   the three runnable starter apps — each one a worked
                        //     example of driving a camera from app state
eslint.config.mjs
tsconfig.json
package.json
```

Rules that keep it lightweight and layered:

- every `lib/*` file is small, standalone, and exported — `createApp` holds no
  logic of its own, only composition.
- `modules/` may import only the public `lib/` surface — proving the module
  contract is sufficient, since built-ins get no private access.
- every module is a folder with an `index.ts`; no loose files at the top of
  `modules/`, so a module can grow internals without changing its import path.
- exports map: `.` → the lib barrel, explicit `./modules/<name>` entries for the
  folder indexes, then `./modules/*` for the deep files (`post/webgl/bloom`).
  The specific entries must precede the wildcard.
- each effect exists exactly once, and shared GLSL lives in one place — a pass
  composes `shared/glsl.ts` rather than re-inlining a kernel.

## Tooling

- **TypeScript** strict, `type: module`, build = `tsc` → `dist/` with `.d.ts`.
- **eslint 10.7** flat config extending `@tuomashatakka/eslint-config@^4`
  (peers eslint ≥10 — satisfied).
- **vitest** for unit tests colocated as `*.test.ts` — clock, store, loop,
  dispose, and module handling are testable headless via `tick()`.
- **vite** builds `site/` (multipage: landing + interactive app) → `site/dist`,
  consuming the built package by name; `npm run dev` serves it. CI (`pages.yml`)
  runs `tsc` then the Vite build and publishes `site/dist` to GitHub Pages.
- **deps**: `@tuomashatakka/canvas-loop-framecapper@^1` (runtime),
  `three@>=0.160` (peer), `@types/three` (dev).

## Milestones

| # | deliverable | proves |
|---|-------------|--------|
| M0 | scaffolding: package.json, tsconfig, eslint, vitest, empty barrel | lint + typecheck + test pipeline green on day one |
| M1 | `lib/`: time, state, render, lifecycle, input — each with tests | every functional layer stands alone |
| M2 | `lib/app/`: createApp + defineModule + handles | the composition and the contract |
| M3 | root `modules/`: lighting + orbit | built-ins live outside the core, on public API only |
| M4 | playground scene + full verification (lint, typecheck, test, build) | it actually runs |

## Later (not now)

Lifecycle event emitter, async `app.ready`, worker update bridges, a
declarative JSX layer (and possibly a react adapter) on top of this same core,
particles, voxels, instancing. Each lands as an additive layer — nothing in
this plan blocks them.

LLM prop authoring landed the same way, as `modules/authoring`: a JSON dialect
small models can actually hit, a validator that repairs their habitual mistakes
rather than rejecting them, a deterministic compiler to `Prop`, and a critic that
measures the built geometry so the model can be told what is wrong with it and
try again. It is the one module that imports another (`modules/assets`, for
`Prop` and the material presets) — and only through that module's public index,
so the layering rule still holds. Nothing in it touches the DOM or a GL context,
so the whole pipeline runs server-side and headless.

Post-processing landed as exactly such an additive layer: `postProcessing()` in
`modules/`, wired through the module `render` hook (item 5 above), with the WebGL
effect catalogue under `modules/post/`. A live, parametrized demo of every effect
ships on the GitHub Pages site (`site/app.html`) — the same page doubles as the
dev playground, and it drives the real `postProcessing()` API on the built
package (dogfooding). WebGPU/TSL effects remain out of scope for now.
