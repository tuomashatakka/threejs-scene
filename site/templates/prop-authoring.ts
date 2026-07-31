// LLM prop authoring
// ------------------
// A turntable of props that were never written as code. Every object on this
// plinth came out of `modules/authoring`: a few lines of JSON — the dialect a
// small language model is asked to emit — compiled by `buildProp`, then
// measured and critiqued by `reviewProp`.
//
// The last two are the interesting ones. `SLOPPY_OUTPUT` is what a 3B model
// actually returns: prose around the JSON, `"type"` instead of `"shape"`,
// `"cube"` instead of `"box"`, a size as a string, a trailing comma. It builds
// anyway, because the validator repairs what is unambiguous and writes down
// every repair. `BROKEN_OUTPUT` is beyond repair, and shows what the model gets
// told instead — the report that goes back for another turn.
//
// Open the console: each prop logs its critique exactly as the model would
// receive it.

import * as THREE from 'three'

import { createApp, defineModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { createStandardMaterial } from 'threejs-scene/modules/assets'
import { PROP_EXAMPLES, buildProp, reviewProp, tryBuildProp } from 'threejs-scene/modules/authoring'

import type { App, AppModule } from 'threejs-scene'
import type { Prop } from 'threejs-scene/modules/assets'


interface GalleryState {

  /** Camera azimuth around the plinth, in radians. */
  orbit: number

  /** Idle revolve rate, radians/second. */
  orbitSpeed: number
}

const RADIUS  = 6.4
const HEIGHT  = 3
const RING    = 2.1 // radius of the ring the props stand on
const LOOK_AT = new THREE.Vector3(0, 0.5, 0)

// A model that half-remembers the dialect. Every one of these mistakes is
// repaired, with a warning, rather than rejected.
const SLOPPY_OUTPUT = `Sure! Here's a little mushroom:
\`\`\`json
{
  "name": "toadstool",
  "parts": [
    { "type": "tube", "dimensions": "0.16, 0.4, 0.16", "position": { "x": 0, "y": 0.2, "z": 0 }, "colour": "efe6d5", "surface": "wood" },
    { "type": "ball", "dimensions": [0.5, "0.34", 0.5], "position": [0, 0.42, 0], "colour": "#b8412f" },
  ]
}
\`\`\``

// Beyond repair: no parts at all. The report is what the model is shown next.
const BROKEN_OUTPUT = '{ "name": "chair", "components": [] }'

/** Compile every spec, log its critique, and lay the results out in a row. */
function gallery (): AppModule<GalleryState> {
  const props: Prop[] = []

  return defineModule<GalleryState>({
    name: 'prop-gallery',

    build (ctx) {
      const specs = PROP_EXAMPLES.map(example => example.spec)

      for (const spec of specs)
        props.push(buildProp(spec))

      // the same path, from raw model text rather than a written-out spec
      const repaired = tryBuildProp(SLOPPY_OUTPUT)
      if (repaired.prop) {
        props.push(repaired.prop)
        console.info(`[repaired]\n${repaired.report}`)
      }

      console.warn(`[rejected]\n${tryBuildProp(BROKEN_OUTPUT).report}`)

      // stand them in a ring, so the revolving camera always frames the row
      props.forEach((prop, index) => {
        const angle = index / props.length * Math.PI * 2
        prop.position.set(Math.sin(angle) * RING, 0, Math.cos(angle) * RING)
        prop.rotation.y = angle
        ctx.scene.add(prop)
        console.info(reviewProp(prop).report)
      })
    },

    dispose () {
      for (const prop of props)
        prop.dispose()
      props.length = 0
    },
  })
}

/** Plinth and backdrop, so the props have something to stand on. */
function set (): AppModule<GalleryState> {
  return defineModule<GalleryState>({
    name: 'set',

    build (ctx) {
      const backdrop = new THREE.Mesh(
        new THREE.SphereGeometry(30, 32, 24),
        new THREE.MeshStandardMaterial({ color: '#181b22', roughness: 1, side: THREE.BackSide }),
      )
      ctx.scene.add(backdrop)

      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(RING + 1, RING + 1.15, 0.3, 64),
        createStandardMaterial('matte', { color: '#2b3039', roughness: 0.7 }),
      )
      plinth.position.y    = -0.15
      plinth.receiveShadow = true
      ctx.scene.add(plinth)
    },
  })
}

/** The camera is the turntable — the props never move. */
function turntable (): AppModule<GalleryState> {
  return defineModule<GalleryState>({
    name: 'turntable',

    build () {
      // nothing to add to the scene — this module only poses the camera
    },

    update (state, _frame, ctx) {
      ctx.camera.position.set(
        Math.sin(state.orbit) * RADIUS,
        HEIGHT,
        Math.cos(state.orbit) * RADIUS,
      )
      ctx.camera.lookAt(LOOK_AT)
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<GalleryState> {
  const app = createApp<GalleryState>(canvas, {
    state:  { orbit: 0.5, orbitSpeed: 0.16 },
    camera: { fov: 42, position: [ 0, HEIGHT, RADIUS ]},
    scene:  { background: '#12141a' },

    use: [
      standardLighting({ sun: { position: [ 6, 10, 5 ], intensity: 2.6, shadowFrustum: 8 }}),
      set(),
      gallery(),
      turntable(),
    ],
  })

  const stopFrame = app.ctx.loop.onFrame(({ delta }) => {
    const { orbit, orbitSpeed } = app.getState()
    app.setState({ orbit: orbit + orbitSpeed * delta })
  })

  const dispose = app.dispose
  app.dispose   = () => {
    stopFrame()
    dispose()
  }
  return app
}

// perf: one draw call per part, a handful of props — trivial. The authoring
// work (validate, build, critique) happens once in build(), never per frame.
