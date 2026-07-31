// Salvage yard — cloth, liquid, and kinetics
// ------------------------------------------
// Three kinds of simulation in one world, stepped by one deterministic clock:
//
//   CLOTH    a tarp lashed to a frame, breathing in the wind. A grid of cannon-es
//            particles held by distance constraints, so it is in the SAME solver
//            as everything else — drop a barrel on it and both react.
//   LIQUID   spatial-hashed position-based fluid: cannon handles obstacles,
//            density constraints keep the volume, and marching cubes draws one
//            continuous surface over the particles.
//   KINETIC  barrels and crates released down a ramp, plus a sign swinging from
//            a hinge constraint.
//
// The scenery is the wasteland kit from `modules/assets` — one merged geometry
// per prop type, one shared flat-shaded material, placed by the keep-out solver
// rather than by hand. Everything is seeded: tap to reset and it runs the same
// way every time.

import * as CANNON from 'cannon-es'
import * as THREE from 'three'

import { createApp, createSeededRng, defineModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { buildKitGeometry, createPlacementField, kitMaterial, scatterInstances } from 'threejs-scene/modules/assets'
import { addGroundPlane, addStaticBox, createCloth, createLiquid, physicsWorld } from 'threejs-scene/modules/physics'

import type { App, AppModule, SceneContext } from 'threejs-scene'
import type { Cloth, Liquid, PhysicsApi } from 'threejs-scene/modules/physics'


interface YardState {

  /** Camera azimuth, radians. */
  orbit: number

  /** Idle revolve rate, radians/second. */
  orbitSpeed: number
}

const RADIUS  = 14
const HEIGHT  = 7.5
const LOOK_AT = new THREE.Vector3(0, 1.4, 0)

const SEED = 1337

/** Everything that is not simulated: ground, ramp, basin, and scattered props. */
function yard (physics: PhysicsApi): AppModule<YardState> {
  const material                                         = kitMaterial()
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [ material ]

  return defineModule<YardState>({
    name: 'yard',

    build (ctx) {
      const rng = createSeededRng(SEED)

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(26, 48).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: '#6b6055', roughness: 1 }),
      )
      ground.receiveShadow = true
      ctx.scene.add(ground)
      owned.push(ground.geometry, ground.material as THREE.Material)

      // the ramp the barrels come down, matched by a static body
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.24, 5.5),
        new THREE.MeshStandardMaterial({ color: '#5a5f66', roughness: 0.8, metalness: 0.2 }),
      )
      ramp.position.set(-3.4, 1.5, 0)
      ramp.rotation.z    = -0.42
      ramp.receiveShadow = true
      ctx.scene.add(ramp)
      owned.push(ramp.geometry, ramp.material as THREE.Material)
      addStaticBox(physics, [ 3.2, 0.24, 5.5 ], [ -3.4, 1.5, 0 ], [ 0, 0, -0.42 ])

      // the basin the liquid pours into. The front wall is cut away visually,
      // while its full-height invisible collider still contains the surface.
      const wallMaterial = new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.9, metalness: 0.3 })
      owned.push(wallMaterial)
      for (const [ x, z ] of [[ 1.6, 0 ], [ -1.6, 0 ], [ 0, 1.6 ], [ 0, -1.6 ]] as const) {
        const physicsSize: [number, number, number] = [ x === 0 ? 3.4 : 0.2, 1.1, z === 0 ? 3.4 : 0.2 ]
        const cutaway                               = z === 1.6
        const visualSize: [number, number, number]  = [ physicsSize[0], cutaway ? 0.34 : physicsSize[1], physicsSize[2] ]
        const wall                                  = new THREE.Mesh(new THREE.BoxGeometry(...visualSize), wallMaterial)
        wall.position.set(4.2 + x, visualSize[1] / 2, z)
        wall.castShadow = wall.receiveShadow = true
        ctx.scene.add(wall)
        owned.push(wall.geometry)
        addStaticBox(physics, physicsSize, [ 4.2 + x, 0.55, z ])
      }

      // scenery: the keep-out solver places it, one draw call per prop type
      const field = createPlacementField({
        rng:    rng.fork('scatter'),
        extent: 24,
        claims: [
          { x: 0, z: 0, radius: 7 }, // the simulations get the middle
          { x: 4.2, z: 0, radius: 4 }, // …and the basin
          { x: -3.4, z: 0, radius: 4 }, // …and the ramp
        ],
      })

      for (const [ name, count, radius, near, far ] of [
        [ 'dead-tree', 12, 1.2, 9, 22 ],
        [ 'rubble-pile', 16, 1.2, 8, 22 ],
        [ 'wreck-car', 4, 2.2, 11, 20 ],
        [ 'barricade', 5, 1.6, 10, 21 ],
        [ 'crag', 12, 3.4, 19, 25 ],
      ] as const) {
        const geometry = buildKitGeometry(name, { rng: rng.fork(name) })
        const spin     = rng.fork(`${name}-spin`)
        const { mesh } = scatterInstances({
          geometry,
          material,
          count,
          place: () => {
            const spot = field.place({ radius, minDistance: near, maxDistance: far })
            return spot && {
              at:     [ spot.x, name === 'crag' ? -0.8 : -0.05, spot.z ],
              rotate: [ 0, spin.next() * Math.PI * 2, 0 ],
              scale:  spin.range(0.85, name === 'crag' ? 1.4 : 1.2),
              tint:   `hsl(0, 0%, ${Math.round(spin.range(78, 108))}%)`,
            }
          },
        })
        ctx.scene.add(mesh)
        owned.push(geometry)
      }
    },

    dispose () {
      for (const resource of owned)
        resource.dispose()
      owned.length = 0
    },
  })
}

/** The three simulations, and the props they act on. */
function simulations (physics: PhysicsApi): AppModule<YardState> {
  const material                                         = kitMaterial()
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [ material ]
  let cloth: Cloth | null   = null
  let liquid: Liquid | null = null

  const frame = (ctx: SceneContext): void => {
    // a lashing frame for the tarp: four uprights, a top rail, all static
    const postGeometry = new THREE.BoxGeometry(0.16, 3.4, 0.16)
    const railGeometry = new THREE.BoxGeometry(4.4, 0.16, 0.16)
    const steel        = new THREE.MeshStandardMaterial({ color: '#585d66', roughness: 0.7, metalness: 0.5 })
    owned.push(postGeometry, railGeometry, steel)

    for (const x of [ -2.1, 2.1 ]) {
      const post = new THREE.Mesh(postGeometry, steel)
      post.position.set(x, 1.7, -1.6)
      post.castShadow = true
      ctx.scene.add(post)
      addStaticBox(physics, [ 0.16, 3.4, 0.16 ], [ x, 1.7, -1.6 ])
    }

    const rail = new THREE.Mesh(railGeometry, steel)
    rail.position.set(0, 3.4, -1.6)
    rail.castShadow = true
    ctx.scene.add(rail)
  }

  return defineModule<YardState>({
    name: 'simulations',

    build (ctx) {
      const rng = createSeededRng(SEED + 1)
      addGroundPlane(physics)
      frame(ctx)

      // ── cloth ──────────────────────────────────────────────────────────
      cloth = createCloth(physics, {
        size:       [ 4, 2.6 ],
        segments:   14,
        mass:       2.4,
        at:         [ -2, 3.32, -1.6 ],
        pin:        'top-edge',
        wind:       [ 0, 0, 4 ],
        gust:       0.55,
        nodeRadius: 0.06,
        material:   new THREE.MeshStandardMaterial({ color: '#8a4b2d', side: THREE.DoubleSide, roughness: 0.95, flatShading: true }),
      })
      ctx.scene.add(cloth.mesh)

      // ── liquid ─────────────────────────────────────────────────────────
      liquid = createLiquid(physics, {
        count:          320,
        at:             [ 4.2, 2.2, 0 ],
        spawn:          [ 1.6, 1.1, 1.6 ],
        radius:         0.08,
        neighborRadius: 0.24,
        iterations:     4,
        viscosity:      0.02,
        cohesion:       0.01,
        color:          '#3f8d78',
        rng:            rng.fork('liquid'),
      })
      ctx.scene.add(liquid.mesh)

      // ── kinetics ───────────────────────────────────────────────────────
      // atomic barrels and crates are direct children of a drop root;
      // addEach gives every child its own body rather than binding the pile.
      const drop = rng.fork('drop')
      for (const [ name, count, mass ] of [[ 'barrel', 6, 7 ], [ 'crate', 5, 5 ]] as const) {
        const geometry = buildKitGeometry(name, { rng: rng.fork(name) })
        owned.push(geometry)

        const dropRoot = new THREE.Group()

        for (let i = 0; i < count; i++) {
          const mesh      = new THREE.Mesh(geometry, material)
          mesh.castShadow = mesh.receiveShadow = true
          mesh.position.set(-6 + drop.range(-0.6, 0.6), 4.6 + i * 1.4, drop.range(-1, 1))
          dropRoot.add(mesh)
        }
        ctx.scene.add(dropRoot)
        physics.addEach(dropRoot, { mass, restitution: 0.08, friction: 0.85, angularDamping: 0.45 })
      }

      // a sign hanging off a hinge — kinetics you can read at a glance
      const signGeometry = buildKitGeometry('road-sign')
      const sign         = new THREE.Mesh(signGeometry, material)
      sign.castShadow    = true
      sign.position.set(1.4, 2.4, 2.6)
      ctx.scene.add(sign)
      owned.push(signGeometry)

      const signBody = physics.add(sign, { mass: 6, size: [ 1.6, 2.6, 0.2 ]})
      const anchor   = new CANNON.Body({ mass: 0 })
      anchor.position.set(1.4, 3.7, 2.6)
      physics.addBody(anchor)
      physics.world.addConstraint(new CANNON.PointToPointConstraint(
        signBody, new CANNON.Vec3(0, 1.3, 0),
        anchor, new CANNON.Vec3(0, 0, 0),
      ))
      signBody.angularVelocity.set(0, 2.6, 0)
    },

    dispose () {
      cloth?.dispose()
      liquid?.dispose()
      cloth  = null
      liquid = null
      for (const resource of owned)
        resource.dispose()
      owned.length = 0
    },
  })
}

/** The camera is the turntable — nothing in the yard is moved for the shot. */
function turntable (): AppModule<YardState> {
  return defineModule<YardState>({
    name: 'turntable',

    build () {
      // camera-only module
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

export function mount (canvas: HTMLCanvasElement): App<YardState> {
  const physics = physicsWorld<YardState>({ gravity: [ 0, -9.82, 0 ], step: 1 / 60, iterations: 16 })

  const app = createApp<YardState>(canvas, {
    state:  { orbit: 0.9, orbitSpeed: 0.12 },
    seed:   SEED,
    camera: { fov: 46, position: [ 0, HEIGHT, RADIUS ], far: 200 },
    scene:  { background: '#1b1a17' },

    use: [
      standardLighting({ sun: { position: [ 8, 14, 6 ], intensity: 2.4, shadowFrustum: 18 }}),
      physics,
      yard(physics),
      simulations(physics),
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

// perf: ~8 draw calls for the scenery (one per instanced prop type) + one for
// the liquid surface + the cloth + kinetic props. The step is the real cost:
// 169 cloth particles with ~450 constraints and 320 fluid particles using a
// spatial hash with four local constraint passes, all at a fixed 60Hz.
