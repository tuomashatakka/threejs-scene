// Realistic product display
// -------------------------
// A studio turntable: seamless backdrop, image-based lighting, physically
// tuned materials, and drag-to-spin with inertia. The realism here is almost
// entirely lighting and material discipline — an environment map for glass and
// metal to reflect, one soft key shadow, and restrained post (a whisper of
// bloom plus a gentle grade). No effect is doing the heavy lifting.

import * as THREE from 'three'

import { createApp, defineModule, attachPointerGesture } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { postProcessing } from '@tuomashatakka/threejs-scene/modules/post'
import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { createGradePass } from '@tuomashatakka/threejs-scene/modules/post/grade-pass'
import { Prop, createStandardMaterial } from '@tuomashatakka/threejs-scene/modules/assets'

import type { App, AppModule } from '@tuomashatakka/threejs-scene'


interface ProductState {

  /** Turntable angle in radians. */
  spin: number

  /** Idle rotation rate in radians/second; drag overrides it momentarily. */
  autoSpin: number
}

/** The hero object — swap this factory to display something else. */
function buildProduct (): Prop {
  const product = new Prop('product')

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.68, 1.5, 64, 1, false),
    createStandardMaterial('metal', { color: '#c8ccd4', roughness: 0.18, metalness: 1 }),
  )
  body.position.y = 0.75
  body.castShadow = true

  // a real bevel instead of a hard rim — catches a highlight and reads as machined
  const bevel = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.035, 16, 64),
    createStandardMaterial('chrome'),
  )
  bevel.position.y = 1.5
  bevel.rotation.x = Math.PI / 2
  bevel.castShadow = true

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    createStandardMaterial('glass', { thickness: 0.5, roughness: 0.02, ior: 1.52 }),
  )
  dome.position.y = 1.5

  const accent = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.02, 12, 48),
    createStandardMaterial('emissive', { emissive: '#79f7ff', emissiveIntensity: 3 }),
  )
  accent.position.y = 0.42
  accent.rotation.x = Math.PI / 2

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.78, 0.12, 64),
    createStandardMaterial('rubber', { color: '#16181d' }),
  )
  base.position.y = 0.06
  base.castShadow = true

  return product
    .addPart('base', base)
    .addPart('body', body)
    .addPart('accent', accent)
    .addPart('bevel', bevel)
    .addPart('dome', dome)
}

/** Backdrop + shadow catcher: an infinite-sweep studio cyclorama. */
function studioSet (): AppModule<ProductState> {
  return defineModule<ProductState>({
    name: 'studio-set',

    build (ctx) {
      // A large sphere seen from inside gives a seamless horizon with no visible
      // corner — the classic product-shot cyclorama, for the price of one mesh.
      const backdrop = new THREE.Mesh(
        new THREE.SphereGeometry(28, 48, 32),
        new THREE.MeshStandardMaterial({ color: '#20232b', roughness: 1, metalness: 0, side: THREE.BackSide }),
      )
      ctx.scene.add(backdrop)

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(9, 64),
        createStandardMaterial('matte', { color: '#2a2e37', roughness: 0.55, metalness: 0.1 }),
      )
      floor.rotation.x    = -Math.PI / 2
      floor.receiveShadow = true
      ctx.scene.add(floor)

      // rim light from behind separates the silhouette from the backdrop
      const rim = new THREE.SpotLight('#bcd8ff', 45, 24, Math.PI / 6, 0.5, 2)
      rim.position.set(-5, 6, -6)
      rim.target.position.set(0, 1, 0)
      ctx.scene.add(rim, rim.target)
    },
  })
}

/** Turntable: idle rotation, drag to spin, inertia on release. */
function turntable (): AppModule<ProductState> {
  let product: Prop | null = null

  return defineModule<ProductState>({
    name: 'turntable',

    build (ctx) {
      product = buildProduct()
      ctx.scene.add(product)
    },

    update (state, frame) {
      if (product)
        product.rotation.y = state.spin
      void frame
    },

    dispose () {
      product?.dispose()
      product = null
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<ProductState> {
  const app = createApp<ProductState>(canvas, {
    state:  { spin: 0, autoSpin: 0.35 },
    seed:   1,
    camera: { position: [ 3.4, 2.3, 4.2 ], lookAt: [ 0, 1, 0 ], fov: 38 },
    scene:  { background: '#20232b' },
    use:    [
      standardLighting({
        env:  { intensity: 1.15 }, // IBL — glass and chrome need this to read
        sun:  { position: [ 5, 9, 4 ], intensity: 2.2, shadowMapSize: 2048, shadowFrustum: 8 },
        hemi: { skyColor: '#dce8ff', groundColor: '#2a2620', intensity: 0.5 },
      }),
      studioSet(),
      turntable(),
      postProcessing<ProductState>({
        bloom:   false,
        effects: ctx => [
          createBloom({ strength: 0.22, threshold: 0.82, width: ctx.width, height: ctx.height }),
          createGradePass({ contrast: 1.06, saturation: 1.04, vignette: 0.3 }),
        ],
      }),
    ],
  })

  // Drag to spin; velocity carries after release and decays back to idle.
  let velocity = 0
  let dragging = false

  const detach = attachPointerGesture(canvas, {
    onDrag (dx) {
      dragging = true
      velocity = dx * 0.01
      app.setState({ spin: app.getState().spin + velocity })
    },
  })

  const stopFrame = app.ctx.loop.onFrame(({ delta }) => {
    const { spin, autoSpin } = app.getState()
    if (dragging) {
      // one frame of grace, then hand control back to inertia
      dragging = false
      return
    }
    velocity *= Math.pow(0.02, delta) // frame-rate independent decay
    app.setState({ spin: spin + velocity + autoSpin * delta })
  })

  const dispose = app.dispose
  app.dispose   = () => {
    stopFrame()
    detach()
    dispose()
  }
  return app
}

// perf: ~6 draw calls. Transmission (the glass dome) is the expensive part —
// it re-renders the backdrop into a transmission buffer.
