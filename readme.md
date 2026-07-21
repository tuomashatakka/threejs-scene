# @tuomashatakka/threejs-scene

![screenshot](screenshot.png)

Lightweight imperative three.js app shell: `createApp` + a small module
contract. Deterministic clock, seeded rng, unidirectional state flow, strict
dispose chain. The successor core of `threejs-scenes` v3, rebuilt small.

## Install

```sh
npm i @tuomashatakka/threejs-scene three
```

## Use

```ts
import { createApp, defineModule } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { orbitControls } from '@tuomashatakka/threejs-scene/modules/orbit'

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
import { postProcessing } from '@tuomashatakka/threejs-scene/modules/postprocessing'
import { createChromaticAberration } from '@tuomashatakka/threejs-scene/modules/post/webgl/ca'
import { createGradePass } from '@tuomashatakka/threejs-scene/modules/post'

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
grain, and more — lives under `modules/post/` (top-level passes) and
`modules/post/webgl/` (the full set), ported from `threejs-scenes`. WebGL only
for now.

Every effect's parameters are adjustable live in the
[interactive demo](https://tuomashatakka.github.io/threejs-scene/demo.html).

## Layout

`lib/` is grouped by function — `time/` (clock, loop), `state/` (store, rng),
`render/` (renderer, resize), `lifecycle/` (dispose), `input/`
(pointer-gesture), `app/` (composition root). Behavior modules live in root
`modules/` (lighting, orbit, postprocessing + the `post/` effect catalogue) and
use only the public surface. `site/` is the Vite-built public site — a marketing
landing page plus one interactive page that is both the dev playground and the
live post-processing demo, built on the real (published) package.

The frame loop is backed by
[`@tuomashatakka/canvas-loop-framecapper`](https://www.npmjs.com/package/@tuomashatakka/canvas-loop-framecapper)
— one shared `requestAnimationFrame` for the whole page; note that an `fps`
cap applies page-globally.

## Scripts

`npm run dev` (build the package, then serve `site/` with Vite — the playground
+ live demo in one) · `npm test` (vitest) · `npm run typecheck` · `npm run lint` ·
`npm run build` (tsc → `dist/`) · `npm run build:site` (Vite → `site/dist/`, the
deployed site, which consumes the built package). CI builds both and publishes
`site/dist` to GitHub Pages.
