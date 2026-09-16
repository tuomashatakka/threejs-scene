---
name: threejs-scene
description: Build, extend and debug three.js scenes with the threejs-scene package — vanilla three.js with a deterministic app shell and a scoped module contract. Use when the project depends on threejs-scene, or when asked to build a WebGL/three.js scene, add a scene module, write a post-processing pass, generate procedural props, or fix a three.js scene that drifts between runs, leaks GPU memory, or drops frames. Not for react-three-fiber.
---

# threejs-scene

Vanilla three.js, imperative, deterministic. `createApp` owns the only frame loop; everything else
is an `AppModule` mounted into it. No JSX, no `useFrame`, no reconciler.

## Read order

1. `node_modules/threejs-scene/llms.txt` — every export with its real signature, generated from the
   built `.d.ts`, so it cannot drift from the installed version. **Never guess a signature.**
2. `node_modules/threejs-scene/llm/AGENTS.md` — how to compose the package: the contract, the three
   properties, the rules, the recipes. This file is the summary; that one is the reference.
3. `npx threejs-scene modules` — what modules exist, what each provides and requires, what it costs.
4. `npx threejs-scene rules SC004` — any rule in full.

## The contract

```ts
const module = defineModule<State>({
  name:     'turbine',        // unique; also the rng fork label
  provides: [ Token ],        // published with ctx.provide
  requires: [ Other ],        // resolved with ctx.resolve; orders providers first
  select:   state => state.turbine,

  build (ctx)               {},  // create ONCE, into ctx.root, through ctx.own
  start (ctx)               {},  // every module has built — resolve peers here
  update (view, frame, ctx) {},  // project the slice onto the scene; ctx.commit to write back
  resize (size, ctx)        {},
  render (frame, ctx)       {},  // optional: claims the frame draw
  dispose ()                {},  // only for what ctx.own could not cover
})
```

`ctx.root` is the module's subtree (auto-attached, auto-disposed). `ctx.own(x)` registers anything
disposable for teardown and returns it. `ctx.rng` is already forked by module id. `ctx.commit(patch)`
queues a state write that lands at the tick boundary — never mid-tick.

```ts
const app = createApp<State>(canvas, {
  state: { … }, seed: 1, loop: { fps: 0 }, use: [ standardLighting(), module ],
})
app.start()
```

## The three properties

- **Scoped** — a module owns a subtree, a random stream, a state key and a disposal ledger, and
  nothing else owns those. Teardown is the exact inverse of build, whether the module remembered or
  not.
- **Unidirectional** — `store → select → update → scene`, with writes queued and drained after every
  module has updated. Every module in a tick sees the same state object.
- **Deterministic** — mount order is a stable topological sort over declared capabilities; the rng
  forks by name; the clock is fixed. Same seed plus same ticks reproduces the same world.

## The rules that catch real bugs

| code | short |
| --- | --- |
| SC001 | `createApp` owns the only loop — animate in `update`, never `requestAnimationFrame` |
| SC002 | randomness from `ctx.rng`, time from `frame` — never `Math.random`/`Date.now` |
| SC004 | build into `ctx.root`, not `ctx.scene` |
| SC005 | every GPU allocation through `ctx.own` |
| SC006 | never write app state inside a lifecycle hook — `ctx.commit` instead |
| SC012 | generate in `build`, animate in `update`; nothing allocated per tick |
| SC013 | always pass `loop.fps` — the cap is page-global |
| SC017 | lifecycle hooks are synchronous |

Full list, rationale and wrong/right pairs: `llm/RULES.md`, or `npx threejs-scene rules`.

## Recipes worth memorising

**Own what you build.** `ctx.root.add(ctx.own(new THREE.Mesh(geometry, material)))` — `own` returns
its argument, so ownership costs one word.

**Write state from a module.** Only a module that declares the key it owns may commit:

```ts
defineScopedModule<State, 'weather'>('weather', { rain: 0 }, {
  name:  'weather',
  build: () => {},
  update: (weather, frame, ctx) => ctx.commit({ rain: weather.rain + frame.delta * 0.1 }),
})
```

**Talk between modules.** `capability<Api>('name')`, declare in `provides`/`requires`,
`ctx.provide` in `build`, `ctx.resolve` in `start`. Use `optional` + `ctx.tryResolve` when the peer
may not be mounted.

**Size to the device.** Mount `qualityGovernor()`; heavy modules declare `optional: [ Quality ]` and
read `ctx.tryResolve(Quality)?.tier.budget`.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

```ts
import { auditModule, headlessApp } from 'threejs-scene/testing'

const audit = auditModule(() => myModule(), { seed: 7 })
// audit.report === ''  · violations, leaks, stranded children, and a two-run determinism check
```

At runtime, `app.violations` should be empty. Every entry names a rule code, the module, and the
call site.

Static checking: add the shipped ESLint plugin to `eslint.config.mjs`.

```js
import threejsScene from 'threejs-scene/eslint'
export default [ ...threejsScene.configs.recommended ]
```

## Specialised agents

Installable with `npx threejs-scene agents install`:

`threejs-scene-builder` (compose a scene) · `threejs-scene-module-author` (write a module) ·
`threejs-scene-effect-author` (passes and GLSL) · `threejs-scene-asset-author` (procedural content) ·
`threejs-scene-determinism-auditor` · `threejs-scene-perf-auditor`
