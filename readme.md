# threejs-scene

![screenshot](screenshot.png)

Lightweight imperative three.js app shell: `createApp` + a small module
contract. Deterministic clock, seeded rng, unidirectional state flow, strict
dispose chain. The successor core of `threejs-scenes` v3, rebuilt small.

## Install

```sh
npm i threejs-scene three
```

## Use

```ts
import { createApp, defineModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'

interface State { speed: number }

const turbine = defineModule<State>({
  name: 'turbine',
  build (ctx)                { /* create objects once, add to ctx.scene */ },
  update (state, frame, ctx) { /* project state onto them, every sim tick */ },
})

const app = createApp<State>(canvas, {
  state: { speed: 1 },
  seed:  7,
  clock: { mode: 'fixed', step: 1 / 120 },
  use:   [ standardLighting(), orbitControls() ],
})

app.use(turbine)          // runtime add; returned handle.remove() tears down
app.start()               // or app.tick() for deterministic stepping
app.setState({ speed: 2 })
app.dispose()
```

The contract: state flows down (`store -> module.update -> scene`, once per
simulation tick), input flows back through `setState`/`dispatch` — never
straight into scene objects. Same seed + same tick sequence reproduce the
exact same world, headless included.

## Post-processing

Post-processing is a pluggable module, same contract as lighting and orbit —
drop it into `use: [ … ]` and it owns the frame draw through a module `render`
hook (no composer wiring at the call site):

```ts
import { postProcessing, createGradePass } from 'threejs-scene/modules/post'
import { createChromaticAberration } from 'threejs-scene/modules/post/webgl/ca'

const app = createApp(canvas, {
  use: [
    standardLighting(),
    postProcessing({
      bloom:   { strength: 0.8 },
      depth:   true,                       // for DOF / god rays / motion blur
      effects: () => [ createChromaticAberration({ strength: 1.2 }), createGradePass({}) ],
      onFrame: ({ elapsed }, ctx) => { /* drive time/camera uniforms */ },
    }),
  ],
})
app.start()
```

It builds an `EffectComposer` (`RenderPass → optional UnrealBloom → your passes
→ OutputPass`, tone-mapped once at OutputPass). The WebGL effect catalogue —
bloom, god rays, colour grade, DOF, CRT, glitch, chromatic aberration, film
grain, and more — lives under `modules/post/` (the module plus the top-level
passes) and `modules/post/webgl/` (the full set). WebGL only for now.

Each effect exists exactly once. The shared GLSL kernels — the fullscreen vertex
shader, `hash`, chromatic aberration, vignette, grain — live in
`modules/post/shared/glsl.ts` and are composed into each pass, rather than being
re-inlined per file. Passes that own a look keep it: `createGradePass` defaults
its baked grain and chromatic aberration to `0`, so stacking it with
`createFilmGrainPass`/`createChromaticAberration` never double-applies either.

Every effect's parameters are adjustable live in the
[interactive demo](https://tuomashatakka.github.io/threejs-scene/app.html).

## Starter templates

Three scaffolded apps — an isometric tilt-shift endless scape, a third-person
hovership racer, and a studio product display — are on the
[starters page](https://tuomashatakka.github.io/threejs-scene/starters.html),
each showing its complete source beside the running scene. The source is
imported twice (as a module to run, and via Vite's `?raw` to display), so the
code you read is provably the code you are watching.

Each one is a worked example of tying a camera to something else in the scene:

- **Isometric** — drag to pan, wheel/pinch to zoom. One `zoom` number drives the
  frustum, the rig's elevation, the fog band and the tilt-shift blur together,
  so zooming in tips the camera up toward the horizon as the bokeh thickens.
  Panning moves the terrain's *sample origin* rather than the camera, which is
  why the map is endless in every direction.
- **Hovership** — the ship reads the track's curvature ahead and brakes exactly
  as late as it can, so it runs flat out down the straights. The camera racks
  focus off that throttle: out to the horizon under acceleration, back onto the
  ship under braking, with the aperture opening through both.
- **Product** — the camera revolves around a product that never moves (so the
  key light rakes across it, which spinning the object cannot fake), and the
  pointer leans the rig a few degrees for parallax.

## Content: props, materials, textures

`modules/assets` is the content layer — plain factories rather than app modules:

```ts
import { Prop, markShared, createStandardMaterial, treeProp } from 'threejs-scene/modules/assets'

const ship = new Prop('ship')
  .addPart('hull', new THREE.Mesh(hullGeometry, createStandardMaterial('metal')))
  .addPart('canopy', new THREE.Mesh(domeGeometry, createStandardMaterial('glass')))

scene.add(ship)
ship.dispose()   // frees every geometry/material/texture it owns, exactly once
```

A `Prop` is a `THREE.Group` of child meshes with a disposal contract: it owns
everything it contains **unless** the resource is tagged with `markShared()`.
That makes sharing a pooled material a deliberate, visible act, and keeps
`dispose()` safe to call without blanking a neighbour's material.

Also here: `MATERIAL_PRESETS` (`metal`, `chrome`, `gold`, `plastic`, `rubber`,
`glass`, `matte`, `emissive`), `createToonMaterial`, seeded DOM-free procedural
textures (`createGridTexture`, `createNoiseTexture`, `createGradientTexture`),
and a starter prop catalogue (`crystalProp`, `rockProp`, `treeProp`,
`lampPostProp`).

## Cameras

Beyond the default perspective rig, `createApp({ camera })` accepts any prebuilt
camera — including the two the library ships:

```ts
import { createIsoCamera, resizeIsoCamera, aimIsoCamera, createFollowCamera } from 'threejs-scene'

const camera = createIsoCamera(aspect, { viewSize: 20, flavor: 'dimetric' })
const rig    = createFollowCamera({ offset: [ 0, 2.6, -7.5 ] })

camera.userData.viewSize = 12          // zoom is a frustum change …
resizeIsoCamera(camera, aspect)
aimIsoCamera(camera, { tilt: 22 })     // … and elevation is a pose change
```

`createIsoCamera` builds a true-iso or dimetric orthographic rig;
`createFollowCamera` is a damped third-person chase camera whose offset is
expressed in the target's local space, so it banks and turns with it.

`rig.aim(station)` re-aims a follow rig at runtime — seat, look point and both
damping half-lives — which makes swapping between camera stations a lerp of the
two presets rather than a second camera:

```ts
rig.aim({ offset: [ 0, 0.42, 0 ], lookOffset: [ 0, 0.42, 24 ], positionDamping: 0 })
```

`lookOffset` is in the target's local space, so it aims *down the target's nose*
rather than at the target — that is what a cockpit view needs. Damping is part of
a station on purpose: exponential smoothing settles roughly `speed × half-life`
behind a moving target, which is the drift that gives a chase camera its weight
and is exactly what you must not have when the camera is bolted inside the hull.
Use `positionDamping: 0` for anything rigidly attached. Ortho
frustums are not handled by the built-in resize (it only fixes perspective
aspect) — call `resizeIsoCamera` from a module `resize` hook. `aimIsoCamera`
re-aims a built rig at runtime, falling back to whatever pose it already has for
every field you omit, so a zoom handler can swing the tilt without knowing the
rest of the setup.

## Layout

`lib/` is grouped by function — `time/` (clock, loop), `state/` (store, rng),
`render/` (renderer, resize), `camera/` (iso + follow rigs), `lifecycle/`
(dispose), `input/` (pointer-gesture), `app/` (composition root).

Every entry in `modules/` is a folder with an `index.ts` — `lighting/`,
`orbit/`, `post/` (the post-processing module, its passes, `shared/` GLSL, and
the `webgl/` catalogue), and `assets/` (props, materials, textures). They use
only the public surface.

`site/` is the Vite-built public site: a landing page, one interactive page that
is both the dev playground and the live post-processing demo, and the starters
gallery — all built on the real (published) package.

The frame loop is backed by
[`@tuomashatakka/canvas-loop-framecapper`](https://www.npmjs.com/package/@tuomashatakka/canvas-loop-framecapper)
— one shared `requestAnimationFrame` for the whole page; note that an `fps`
cap applies page-globally.

## Scripts

`npm run dev` (build the package, then serve `site/` with Vite — the playground
+ live demo in one) · `npm test` (vitest) · `npm run typecheck` · `npm run lint` ·
`npm run build` (clean, then tsc → `dist/`) · `npm run build:site` (Vite →
`site/dist/`, the deployed site, which consumes the built package). CI builds
both and publishes `site/dist` to GitHub Pages.

`build` cleans `dist/` first on purpose: `tsc` never removes stale output, so a
renamed or deleted module would otherwise linger and keep resolving.
