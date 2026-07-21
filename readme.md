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

## Layout

`lib/` is grouped by function — `time/` (clock, loop), `state/` (store, rng),
`render/` (renderer, resize), `lifecycle/` (dispose), `input/`
(pointer-gesture), `app/` (composition root). Behavior modules live in root
`modules/` and use only the public surface.

The frame loop is backed by
[`@tuomashatakka/canvas-loop-framecapper`](https://www.npmjs.com/package/@tuomashatakka/canvas-loop-framecapper)
— one shared `requestAnimationFrame` for the whole page; note that an `fps`
cap applies page-globally.

## Scripts

`npm run dev` (vite playground) · `npm test` (vitest) · `npm run typecheck` ·
`npm run lint` · `npm run build` (tsc → `dist/`)
