# threejs-scene/eslint

Static enforcement of the package contract. The runtime catches a violation the first time the
offending line runs — which for a `dispose` that never releases a texture means "in production, on
the twelfth remount". These rules catch the same shapes before the code runs.

Rule names are the kebab ids from the shared rule catalogue, and every message carries the rule
code, so a finding reported here and a violation reported at runtime are recognisably the same
thing.

## Install

```js
// eslint.config.mjs
import threejsScene from 'threejs-scene/eslint'

export default [
  ...threejsScene.configs.recommended,
]
```

Or rule by rule, when you want different severities:

```js
import threejsScene from 'threejs-scene/eslint'

export default [
  {
    plugins: { 'threejs-scene': threejsScene },
    rules:   {
      'threejs-scene/scoped-root':       'error',
      'threejs-scene/no-nondeterminism': 'warn',
    },
  },
]
```

The plugin is plain ESM with no dependencies and is published uncompiled, so it loads directly from
`node_modules`. It works on `.js` and, with a TypeScript parser configured, on `.ts`.

## The rules

| rule | code | severity | catches |
| --- | --- | --- | --- |
| `single-frame-loop` | SC001 | error | `requestAnimationFrame`/`setInterval` in a lifecycle hook, and `ctx.loop.onFrame` |
| `no-nondeterminism` | SC002 | error | `Math.random()`, `Date.now()`, `performance.now()`, `new Date()` |
| `fork-rng-by-name` | SC003 | warn | drawing from the shared rng stream inside `build` |
| `scoped-root` | SC004 | error | `ctx.scene.add(…)` inside a lifecycle hook |
| `no-state-write-in-update` | SC006 | error | assigning to the state view; `setState`/`store.set` in a hook |
| `sync-lifecycle` | SC017 | error | an `async` lifecycle method |
| `dom-free-assets` | SC014 | error | `document`, `window`, `new Image()`, `OffscreenCanvas` under `modules/assets/` |

### single-frame-loop

```ts
// wrong
build (ctx) { ctx.loop.onFrame(() => spin()); requestAnimationFrame(tick) }

// right
update (state, frame, ctx) { spin(frame.delta) }
```

### no-nondeterminism

```ts
// wrong
const x = Math.random() * 10; mesh.rotation.y = Date.now() * 0.001

// right
const x = ctx.rng.range(0, 10); mesh.rotation.y = frame.elapsed
```

### fork-rng-by-name

```ts
// wrong — couples this to every other consumer's draw order
const height = ctx.rng.range(1, 3)

// right
const trees  = ctx.rng.fork('trees')
const height = trees.range(1, 3)
```

### scoped-root

```ts
// wrong
build (ctx) { ctx.scene.add(mesh) }

// right
build (ctx) { ctx.root.add(mesh) }
```

### no-state-write-in-update

```ts
// wrong
update (state) { state.speed += 1; app.setState({ speed: 2 }) }

// right
update (state, frame, ctx) { ctx.commit({ speed: state.speed + 1 }) }
```

### sync-lifecycle

```ts
// wrong
async build (ctx) { const gltf = await load(url); ctx.root.add(gltf.scene) }

// right
const gltf = await load(url)
app.use(modelModule(gltf))
```

### dom-free-assets

```ts
// wrong
const canvas = document.createElement('canvas')

// right
new THREE.DataTexture(pixels, width, height)
```

## Scope and false positives

The lifecycle rules only run on files that look like they author a module — the file mentions
`defineModule`, `defineScopedModule`, `AppModule` or `ModuleContext`. A file that merely *uses* the
package is not linted by them.

`single-frame-loop` and `scoped-root` only match calls on `ctx`. `createApp` itself calls
`loop.onFrame` and `scene.add` on its own locals, and it must — it is the app. Matching a bare
`.loop.onFrame` would flag the one place allowed to own the loop, which is how a linter earns a
blanket disable comment.

`no-nondeterminism` skips tests, demo and script directories, `lib/time/` (where wall-clock time
belongs) and `lib/input/` (a tap threshold is a claim about a human's thumb, not about the
simulation).

The rules prefer false negatives to false positives throughout. If one fires on code you believe is
correct, disable that line with a reason rather than removing the rule:

```ts
// eslint-disable-next-line threejs-scene/no-nondeterminism -- seeding the seed itself, once, at boot
const seed = Date.now()
```

## Disabling honestly

Every rule maps to a rule in `llm/RULES.md` explaining what breaks when it is ignored. Read the
rationale before switching one off — all seven describe code that compiles, runs, and is still
wrong, which is exactly the category a linter is for.
