// modules/physics/liquid.ts
// Liquid, as smoothed-particle hydrodynamics.
//
// cannon-es ships an `SPHSystem` that almost nobody uses, and it is the real
// thing: each particle samples its neighbours inside a smoothing radius and gets
// pressure and viscosity forces from the density it finds there. Fluid falls out
// of that — it puddles, it sloshes, it finds its own level — without anyone
// scripting a wave.
//
// It is a subsystem of the same world as the rigid bodies, so the liquid pours
// over whatever else is in the scene, and the particles are ordinary bodies, so
// obstacles push back. What it is NOT is a renderer: drops are drawn as instanced
// spheres, which reads as thick slurry rather than clear water — the honest look
// for a few hundred particles, and much cheaper than screen-space fluid.

import * as CANNON from 'cannon-es'
import * as THREE from 'three'

import type { Disposable, SeededRng, Vec3 } from '../../lib/index.js'
import type { PhysicsApi } from './world.js'


/** Options for {@link createLiquid}. */
export interface LiquidOptions {

  /** Particle count. SPH neighbour search is O(n²) here — a few hundred. @defaultValue 240 */
  count?: number

  /** Centre of the box the liquid starts in, in metres. @defaultValue `[0, 2, 0]` */
  at?: Vec3

  /** Size of that box, in metres. @defaultValue `[1, 1, 1]` */
  spawn?: Vec3

  /** Drawn radius of one drop, in metres. @defaultValue 0.09 */
  radius?: number

  /**
   * SPH smoothing radius — how far a particle looks for neighbours. Below about
   * 2× the particle radius the fluid finds nobody and rains as dust; far above
   * it, everything is everyone's neighbour and it moves like jelly.
   * @defaultValue 0.28
   */
  smoothing?: number

  /** Rest density. Higher packs the fluid tighter. @defaultValue 1.6 */
  density?: number

  /** Resistance to shear — 0.01 is water, 0.1 is oil, 1 is tar. @defaultValue 0.03 */
  viscosity?: number

  /** Mass per particle, in kilograms. @defaultValue 0.02 */
  mass?: number

  /** Deterministic spawn jitter. Without it, a perfect lattice explodes symmetrically. */
  rng?: SeededRng

  /** Material for the drops. */
  material?: THREE.Material

  /** Colour when no material is given. @defaultValue `'#2f5c46'` */
  color?: THREE.ColorRepresentation
}

/** A simulated body of liquid. */
export interface Liquid extends Disposable {

  /** One instanced sphere per particle — a single draw call. */
  readonly mesh: THREE.InstancedMesh

  /** The particle bodies. */
  readonly particles: readonly CANNON.Body[]

  /** The SPH subsystem, for live tuning of `viscosity`, `density`, `smoothingRadius`. */
  readonly sph: CANNON.SPHSystem

  /** Drop every particle back into the spawn box. */
  reset (): void
}

/**
 * Fill a box with SPH fluid inside an existing physics world.
 *
 * @returns A {@link Liquid}. Add `mesh` to the scene; `dispose()` removes every
 * particle from the world.
 * @remarks Contain it with static geometry — {@link addStaticBox} walls or a
 * ground plane. With nothing to hold it, SPH does exactly what a puddle does on
 * a table and spreads until it is one particle thick.
 * @example
 * const pool = createLiquid(physics, {
 *   count: 300, at: [ 0, 2.4, 0 ], spawn: [ 1.2, 0.8, 1.2 ],
 *   viscosity: 0.05, color: '#3f6d4a', rng,
 * })
 * scene.add(pool.mesh)
 */
export function createLiquid (physics: PhysicsApi, options: LiquidOptions = {}): Liquid {
  const {
    count = 240,
    at = [ 0, 2, 0 ],
    spawn = [ 1, 1, 1 ],
    radius = 0.09,
    smoothing = 0.28,
    density = 1.6,
    viscosity = 0.03,
    mass = 0.02,
    rng,
  } = options

  const sph           = new CANNON.SPHSystem()
  sph.smoothingRadius = smoothing
  sph.density         = density
  sph.viscosity       = viscosity
  physics.world.subsystems.push(sph)

  const geometry = new THREE.IcosahedronGeometry(radius, 1)
  const material = options.material ?? new THREE.MeshStandardMaterial({
    color:     options.color ?? '#2f5c46',
    roughness: 0.25,
    metalness: 0.1,
  })

  const mesh         = new THREE.InstancedMesh(geometry, material, count)
  mesh.castShadow    = true
  mesh.frustumCulled = false

  const particles: CANNON.Body[] = []
  const perSide                  = Math.max(1, Math.ceil(Math.cbrt(count)))

  const spawnAt = (body: CANNON.Body, index: number): void => {
    // a lattice, nudged: a perfectly regular start has every particle at the
    // same distance from every neighbour, which SPH resolves as one huge
    // symmetric shove
    const jitter = rng ? (): number => rng.range(-0.15, 0.15) : (): number => 0
    const column = index % perSide
    const row    = Math.floor(index / perSide) % perSide
    const layer  = Math.floor(index / (perSide * perSide))

    body.position.set(
      at[0] + (column / (perSide - 1 || 1) - 0.5) * spawn[0] * (1 + jitter()),
      at[1] + (layer / (perSide - 1 || 1) - 0.5) * spawn[1] * (1 + jitter()),
      at[2] + (row / (perSide - 1 || 1) - 0.5) * spawn[2] * (1 + jitter()),
    )
    body.velocity.setZero()
    body.angularVelocity.setZero()
    body.wakeUp()
  }

  for (let i = 0; i < count; i++) {
    const body = new CANNON.Body({
      mass,
      shape:         new CANNON.Sphere(radius),
      linearDamping: 0.02,
    })
    // SPH does the particle-vs-particle work; letting the rigid solver ALSO
    // resolve drop-vs-drop contacts fights it and boils the fluid
    body.collisionFilterGroup = 4
    body.collisionFilterMask  = 1
    body.allowSleep           = false

    spawnAt(body, i)
    physics.addBody(body)
    sph.add(body)
    particles.push(body)
  }

  const dummy = new THREE.Object3D()

  const sync = (): void => {
    for (const [ i, body ] of particles.entries()) {
      dummy.position.set(body.position.x, body.position.y, body.position.z)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  const stopSync = physics.onAfterStep(sync)
  sync()

  return {
    mesh,
    particles,
    sph,

    reset () {
      particles.forEach(spawnAt)
      sync()
    },

    dispose () {
      stopSync()
      for (const body of particles) {
        sph.remove(body)
        physics.world.removeBody(body)
      }

      const index = physics.world.subsystems.indexOf(sph)
      if (index >= 0)
        physics.world.subsystems.splice(index, 1)

      geometry.dispose()
      if (!options.material)
        material.dispose()
      mesh.dispose()
      mesh.removeFromParent()
    },
  }
}

// perf: SPH neighbour search is O(n²) in cannon — 240 particles is ~29k pair
// tests per step and unnoticeable; 2000 would be 2M and would not hold 60fps.
// Rendering is one instanced draw call regardless of count.
