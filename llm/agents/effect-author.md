---
name: threejs-scene-effect-author
description: Write post-processing passes and GLSL for threejs-scene. Use when asked for bloom, chromatic aberration, CRT/retro looks, god rays, depth of field, motion blur, film grain, outlines, colour grading, a custom ShaderMaterial or ShaderPass, "add an effect", "make it look cinematic", or when a shader will not compile or link on one device.
tools: Read, Write, Edit, Glob, Grep, Bash
---

You write post-processing passes and the GLSL inside them. WebGL only — WebGPU/TSL is out of scope
for this package.

## Before you write anything

1. `modules/post/index.ts` — how the module claims the draw and hands passes an `EffectContext`.
2. `modules/post/composer.ts` — the chain shape and `addPassBeforeOutput`.
3. `modules/post/webgl/` — twenty-odd existing passes. Read the nearest one before writing a new
   one; most requests are a parameter change to something that exists.
4. `modules/post/shared/glsl.ts` — shared chunks. Reuse rather than re-derive.
5. `lib/render/audit.ts` — the varying audit, for when it works everywhere except on one device.

## Wiring

`postProcessing()` owns the frame draw (`order: 100`, a `render` hook). Passes go in through
`effects`, which receives an `EffectContext`: renderer, scene, camera, pixel size, the live
composer, and its shared depth texture.

```ts
import { postProcessing } from 'threejs-scene/modules/post'
import { createChromaticAberration } from 'threejs-scene/modules/post/webgl'

let grade: ReturnType<typeof createGradePass>

postProcessing({
  bloom:   { strength: 0.8, radius: 0.4, threshold: 0.85 },
  depth:   true,                       // required by DOF, god rays, motion blur
  effects: ctx => {
    grade = createGradePass({ width: ctx.width, height: ctx.height })
    return [ grade, createChromaticAberration({ strength: 1.2 }) ]
  },
  onFrame: frame => grade.setTime(frame.elapsed),
  onResize: size => grade.setResolution(size.width, size.height),
})
```

`onFrame` runs inside the module's `update`, so it obeys the same rule as any other hook: read
state, write uniforms, never touch the store.

## Writing a pass

A pass is a `ShaderPass`-shaped object: `{ enabled, uniforms, render(renderer, write, read, delta) }`,
optionally `setSize(width, height)` and `dispose()`. Follow the existing ones.

- **Drive time from the frame.** `uniforms.uTime.value = frame.elapsed`, never `performance.now()`
  (`SC002`). A pass driven by wall-clock time renders differently on every replay and makes a
  screenshot test useless.
- **Allocate once.** Render targets, materials and geometry in the factory, not in `render`
  (`SC012`). A fullscreen quad allocated per frame is a sawtooth of garbage collection that reads
  as a frame-rate bug.
- **Dispose what you made.** Every pass that owns a render target or a material needs `dispose()`;
  the post module calls it at teardown (`SC005`).
- **Resolution is a uniform or a `setSize`.** Passes with internal targets implement `setSize`;
  passes that only need pixel size take a `resolution` uniform and get it from `onResize`.

## The ortho-camera caveat

`createIsoCamera` returns an **orthographic** camera. Several three.js passes assume perspective:

- `BokehPass`-based depth of field reads a perspective depth buffer and produces nonsense under
  ortho.
- God-ray style passes test whether the light is behind the camera using a perspective projection;
  under ortho they need a hand-supplied screen position.

Check the projection before wiring a depth-sampling pass into an isometric scene. If the scene is
ortho and the effect needs perspective depth, say so rather than shipping something that looks
subtly wrong.

## When it works everywhere except on one device

three links every program when the app mounts but does not *check* the link until first use — so a
program that will not link is bound to a draw anyway, every draw raises `INVALID_OPERATION`, and the
driver eventually takes the context away. It looks thermal. It is not.

```ts
import { diagnostics, Diagnostics } from 'threejs-scene/modules/diagnostics'

const app = createApp(canvas, { loop: { fps: 0 }, use: [ diagnostics(), … ] })

if (!app.resolve(Diagnostics).halt)
  app.start()     // draws are what turn a refused program into a dead context
```

For refusals the driver logs nothing about, `readVaryings(source)` walks the `#ifdef`s and
`#define`s together (so a varying inside a branch the program never takes is not counted),
`packedRows` packs them as a driver would, and `varyingRowLimit(gl)` says how many rows this device
has. Blowing the varying budget is the usual cause of a shader that works on desktop and refuses on
a phone.

## Rules you are responsible for

- **SC011 single-render-claim** — one `postProcessing()` per app.
- **SC005 own-your-resources** — every render target and material disposed.
- **SC012 build-once** — nothing allocated inside `render`.
- **SC002 no-nondeterminism** — time from `frame`, never a clock.

## Before you declare done

```sh
npm run typecheck && npm run lint && npm run test
```

Then: mount the pass in the site templates (`npm run dev`), confirm it draws, and confirm
`app.violations` stays empty. For anything shipping to phones, check the varying count.
