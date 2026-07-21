/// <reference types="vite/client" />
// playground/main.ts
// Dev scene exercising the whole public surface: createApp + defineModule,
// root modules (lighting, orbit), unidirectional state via setState, seeded
// rng determinism, and the dispose chain (HMR).

import * as THREE from 'three'

import { createApp, defineModule } from '../lib/index.js'
import { standardLighting } from '../modules/lighting.js'
import { orbitControls } from '../modules/orbit.js'


interface State {
  speed: number
}

// state -> scene projection, never the reverse
const sculpture = defineModule<State>({
  name: 'sculpture',

  build (ctx) {
    const group = new THREE.Group()
    group.name  = 'sculpture'

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1, 0.32, 220, 32),
      new THREE.MeshStandardMaterial({ color: '#88aaff', metalness: 0.85, roughness: 0.25 }),
    )
    knot.castShadow = true
    group.add(knot)

    // deterministic satellite ring — same seed, same ring, every reload
    const rng = ctx.rng.fork('satellites')
    for (let i = 0; i < 24; i++) {
      const satellite = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rng.range(0.05, 0.16), 1),
        new THREE.MeshStandardMaterial({ color: '#ffd0a0', metalness: 0.4, roughness: 0.5 }),
      )
      const angle  = i / 24 * Math.PI * 2
      const radius = rng.range(2.2, 3.1)
      satellite.position.set(Math.cos(angle) * radius, rng.range(-0.4, 0.4), Math.sin(angle) * radius)
      satellite.castShadow = true
      group.add(satellite)
    }
    ctx.scene.add(group)
  },

  update (state, frame, ctx) {
    const group = ctx.scene.getObjectByName('sculpture')
    if (!group)
      return
    group.rotation.y = frame.elapsed * state.speed * 0.5
    group.rotation.x = Math.sin(frame.elapsed * state.speed * 0.3) * 0.2
  },
})

const ground = defineModule<State>({
  name: 'ground',

  build (ctx) {
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: '#141420', roughness: 0.9 }),
    )
    plane.rotation.x    = -Math.PI / 2
    plane.position.y    = -2
    plane.receiveShadow = true
    ctx.scene.add(plane)
  },
})

const canvas = document.querySelector('canvas')
if (!canvas)
  throw new Error('playground: canvas missing')

const app = createApp<State>(canvas, {
  state:  { speed: 1 },
  seed:   7,
  camera: { position: [ 5, 3, 7 ]},
  use:    [ standardLighting(), orbitControls({ radius: [ 3, 30 ]}) ],
})

app.use(sculpture)
app.use(ground)
app.start()

// input -> setState -> next tick projects it. never straight into the scene.
const slider = document.querySelector<HTMLInputElement>('#speed')
const label  = document.querySelector('output')
slider?.addEventListener('input', () => {
  app.setState({ speed: Number(slider.value) })
  if (label)
    label.textContent = Number(slider.value).toFixed(1)
})

// HMR: full teardown through the dispose chain
if (import.meta.hot)
  import.meta.hot.dispose(() => app.dispose())
