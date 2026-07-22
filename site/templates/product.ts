// Realistic product display
// -------------------------
// A studio turntable where the CAMERA is the turntable: it revolves slowly
// around a product that never moves, so the key light rakes across the metal
// and the glass dome picks up a travelling highlight — exactly what a physical
// product shoot does, and what spinning the object instead cannot fake. The
// pointer adds a small parallax tilt on top, and dragging nudges the revolve
// with inertia.
//
// The realism is almost entirely lighting and material discipline — an
// environment map for glass and metal to reflect, one soft key shadow, and
// restrained post. No effect is doing the heavy lifting.

import * as THREE from 'three'

import { createApp, defineModule, attachPointerGesture } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { postProcessing } from 'threejs-scene/modules/post'
import { createBloom } from 'threejs-scene/modules/post/webgl/bloom'
import { createGradePass } from 'threejs-scene/modules/post/grade-pass'
import { Prop, createStandardMaterial } from 'threejs-scene/modules/assets'

import type { App, AppModule } from 'threejs-scene'


interface ProductState {

  /** Camera azimuth around the product, in radians. */
  orbit: number

  /** Idle revolve rate in radians/second; drag overrides it momentarily. */
  orbitSpeed: number

  /** Pointer parallax, -1..1 per axis, already smoothed by the input layer. */
  tiltX: number
  tiltY: number
}

const ORBIT_RADIUS = 5.4
const ORBIT_HEIGHT = 2.3
const ORBIT_START  = 0.68
const LOOK_AT      = new THREE.Vector3(0, 1, 0)

// How far the pointer may shift the rig. Deliberately tiny: parallax reads as
// the object having presence, but push it and the framing starts wandering,
// which is the one thing a product shot must not do.
const TILT_YAW   = 0.09 // radians of extra azimuth at full deflection
const TILT_RISE  = 0.55 // world units the camera climbs
const TILT_PITCH = 0.14 // counter-move on the look-at, so it reads as a tilt not a crane

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
      // It also means the revolving camera never finds a seam to reveal.
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

/** The product itself. It never moves — the camera does. */
function hero (): AppModule<ProductState> {
  let product: Prop | null = null

  return defineModule<ProductState>({
    name: 'hero',

    build (ctx) {
      product = buildProduct()
      ctx.scene.add(product)
    },

    dispose () {
      product?.dispose()
      product = null
    },
  })
}

/**
 * The revolving camera rig. Pure projection of state onto the camera: given the
 * same `orbit`/`tilt` it always produces the same pose, so nothing accumulates
 * here and a dropped frame can never leave the framing skewed.
 */
function studioCamera (): AppModule<ProductState> {
  return defineModule<ProductState>({
    name: 'studio-camera',

    build () {
      // nothing to create — createApp already owns the camera
    },

    update (state, _frame, ctx) {
      const angle = state.orbit + state.tiltX * TILT_YAW

      ctx.camera.position.set(
        Math.sin(angle) * ORBIT_RADIUS,
        ORBIT_HEIGHT + state.tiltY * TILT_RISE,
        Math.cos(angle) * ORBIT_RADIUS,
      )
      // Rising while aiming slightly lower (and vice versa) is what makes this
      // read as a tilt rather than the camera simply drifting up and down.
      ctx.camera.lookAt(LOOK_AT.x, LOOK_AT.y - state.tiltY * TILT_PITCH, LOOK_AT.z)
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<ProductState> {
  const app = createApp<ProductState>(canvas, {
    state:  { orbit: ORBIT_START, orbitSpeed: 0.22, tiltX: 0, tiltY: 0 },
    seed:   1,
    camera: {
      // matches the rig's first pose, so frame zero is already on-model
      position: [ Math.sin(ORBIT_START) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.cos(ORBIT_START) * ORBIT_RADIUS ],
      lookAt:   [ LOOK_AT.x, LOOK_AT.y, LOOK_AT.z ],
      fov:      38,
    },
    scene: { background: '#20232b' },
    use:   [
      standardLighting({
        env:  { intensity: 1.15 }, // IBL — glass and chrome need this to read
        sun:  { position: [ 5, 9, 4 ], intensity: 2.2, shadowMapSize: 2048, shadowFrustum: 8 },
        hemi: { skyColor: '#dce8ff', groundColor: '#2a2620', intensity: 0.5 },
      }),
      studioSet(),
      hero(),
      studioCamera(),
      postProcessing<ProductState>({
        bloom:   false,
        effects: ctx => [
          createBloom({ strength: 0.22, threshold: 0.82, width: ctx.width, height: ctx.height }),
          createGradePass({ contrast: 1.06, saturation: 1.04, vignette: 0.3 }),
        ],
      }),
    ],
  })

  // Drag nudges the revolve (velocity carries after release and decays back to
  // idle); hovering leans the rig. Both are smoothed HERE rather than in the
  // camera module — feel belongs to the input layer, so the module downstream
  // stays a pure state → pose mapping.
  let velocity = 0
  let dragging = false
  let hoverX   = 0
  let hoverY   = 0

  const detach = attachPointerGesture(canvas, {
    onDrag (dx) {
      dragging = true
      // negative: orbiting the camera one way turns the product the other, and
      // a drag should push the product with the pointer
      velocity = -dx * 0.006
      app.setState({ orbit: app.getState().orbit + velocity })
    },

    onHover (x, y) {
      const rect = canvas.getBoundingClientRect()
      hoverX = Math.max(-1, Math.min(1, (x - rect.left) / rect.width * 2 - 1))
      hoverY = Math.max(-1, Math.min(1, (y - rect.top) / rect.height * 2 - 1))
    },

    // freeze-on-exit looks like a bug; ease back to the neutral framing instead
    onLeave () {
      hoverX = 0
      hoverY = 0
    },
  })

  const stopFrame = app.ctx.loop.onFrame(({ delta }) => {
    const { orbit, orbitSpeed, tiltX, tiltY } = app.getState()
    // slow half-life: parallax should trail the pointer, not snap to it
    const ease = 1 - Math.pow(2, -delta / 0.24)
    const lean = {
      tiltX: tiltX + (hoverX - tiltX) * ease,
      tiltY: tiltY + (hoverY - tiltY) * ease,
    }

    if (dragging) {
      // one frame of grace, then hand control back to inertia
      dragging = false
      app.setState(lean)
      return
    }

    velocity *= Math.pow(0.02, delta) // frame-rate independent decay
    app.setState({ ...lean, orbit: orbit + velocity + orbitSpeed * delta })
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
