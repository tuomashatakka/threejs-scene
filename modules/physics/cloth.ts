// modules/physics/cloth.ts
// Cloth: a grid of particles held together by distance constraints.
//
// It would be cheaper to write a standalone Verlet solver — but then the cloth
// lives in its own universe and cannot see the rigid bodies. Building it out of
// cannon-es particles instead buys two-way interaction for free: a tarp catches
// on a barrel, the barrel feels the tarp, and both go through the same solver at
// the same fixed step. That is the whole reason to use the engine's own
// primitives rather than a private simulation.
//
// The three knobs that decide whether cloth looks like cloth: solver iterations
// (a distance constraint is a spring the solver only partly satisfies, so too
// few iterations reads as rubber), the shear/bend constraints (without diagonals
// the sheet folds like paper; without long links it collapses), and per-particle
// mass (heavy particles sag, light ones flap).

import * as CANNON from 'cannon-es'
import * as THREE from 'three'

import type { Disposable, Vec3 } from '../../lib/index.js'
import type { PhysicsApi } from './world.js'


/** Which particles are nailed in place and never move. */
export type ClothPinning = 'top-edge' | 'top-corners' | 'corners' | 'none' | ((column: number, row: number, columns: number, rows: number) => boolean)

/** Options for {@link createCloth}. */
export interface ClothOptions {

  /** Sheet size in metres, `[width, height]`. @defaultValue `[2, 2]` */
  size?: [number, number]

  /**
   * Particles per side. Cost is O(n²) particles and O(n²) constraints, and the
   * solver iterates all of them — 12 is a flag, 20 is a heavy tarp, past 30 you
   * are paying for detail nobody sees. @defaultValue 12
   */
  segments?: number

  /** Total mass of the sheet, in kilograms. @defaultValue 1 */
  mass?: number

  /** Which particles are fixed. @defaultValue `'top-edge'` */
  pin?: ClothPinning

  /** Where the sheet's top-left corner starts. @defaultValue `[0, 2, 0]` */
  at?: Vec3

  /**
   * Collision radius per particle. 0 uses cannon's zero-volume `Particle`
   * shape — cheapest, but the sheet can slip between thin obstacles.
   * @defaultValue 0.05
   */
  nodeRadius?: number

  /** Velocity bled off per second, 0..1. Cloth needs more than a rigid body. @defaultValue 0.08 */
  damping?: number

  /**
   * Initial bow out of the sheet's plane, as a fraction of its width. A
   * perfectly flat sheet facing a perfectly perpendicular wind is a metastable
   * equilibrium — it has no reason to fold one way rather than the other, and
   * sits there being pushed edge-on until rounding error picks a side. A real
   * tarp is never flat. @defaultValue 0.02
   */
  bow?: number

  /**
   * Steady wind, as an ACCELERATION in m/s² — the same units as gravity, so
   * `[0, 0, 6]` is a bit less than half a g of sideways push. Specifying it as
   * force instead would make the sheet's behaviour depend on its mass and on
   * how many particles it happens to be made of, which is not what anyone means
   * by "wind". @defaultValue `[0, 0, 0]`
   */
  wind?: Vec3

  /** Gust amplitude as a fraction of `wind`. @defaultValue 0.45 */
  gust?: number

  /** Material for the sheet. Double-sided by default — cloth has two faces. */
  material?: THREE.Material
}

/** A simulated sheet: a mesh, its particles, and the wind blowing on it. */
export interface Cloth extends Disposable {

  /** The rendered sheet. Its geometry is rewritten every step. */
  readonly mesh: THREE.Mesh

  /** The particle bodies, row-major. */
  readonly particles: readonly CANNON.Body[]

  /** Change the wind without rebuilding. */
  setWind (wind: Vec3): void

  /** Release a pinned particle — cut the washing line. */
  unpin (column: number, row: number): void
}

function isPinned (pin: ClothPinning, column: number, row: number, columns: number, rows: number): boolean {
  if (typeof pin === 'function')
    return pin(column, row, columns, rows)

  switch (pin) {
    case 'top-edge':
      return row === 0
    case 'top-corners':
      return row === 0 && (column === 0 || column === columns - 1)
    case 'corners':
      return (row === 0 || row === rows - 1) && (column === 0 || column === columns - 1)
    default:
      return false
  }
}

/** The sheet's lattice, in particles and metres. */
interface Grid {
  columns: number
  rows:    number
  stepX:   number
  stepY:   number
}

/** One body per lattice point, pinned or free. */
type BuildParticlesProps = { at: Vec3, pin: ClothPinning, nodeMass: number, nodeRadius: number, damping: number, bow: number }

function buildParticles (
  physics: PhysicsApi,
  { columns, rows, stepX, stepY }: Grid,
  { at, pin, nodeMass, nodeRadius, damping, bow }: BuildParticlesProps,
): CANNON.Body[] {
  const shape                    = nodeRadius > 0 ? new CANNON.Sphere(nodeRadius) : new CANNON.Particle()
  const particles: CANNON.Body[] = []

  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const pinned = isPinned(pin, column, row, columns, rows)
      // a shallow dome, zero at every edge: enough to give the wind a side to
      // catch, far too little to see
      const slack  = bow * columns * stepX *
        Math.sin(Math.PI * column / (columns - 1)) *
        Math.sin(Math.PI * row / (rows - 1))

      const body = new CANNON.Body({
        mass:          pinned ? 0 : nodeMass,
        shape,
        linearDamping: damping,
        position:      new CANNON.Vec3(at[0] + column * stepX, at[1] - row * stepY, at[2] + slack),
      })
      // particles must not collide with their own neighbours or the sheet
      // inflates like a balloon; a separate group keeps them to the world only
      body.collisionFilterGroup = 2
      body.collisionFilterMask  = 1
      // a settled sheet would otherwise fall asleep, and a sleeping body
      // ignores applied force — the tarp goes limp and never feels the wind again
      body.allowSleep = false
      physics.addBody(body)
      particles.push(body)
    }

  return particles
}

/** Structural links along the weave, plus shear diagonals. */
function buildLinks (physics: PhysicsApi, { columns, rows, stepX, stepY }: Grid, particles: CANNON.Body[]): CANNON.DistanceConstraint[] {
  const links: CANNON.DistanceConstraint[] = []
  const stiffness                          = 1e4

  const link = (a: number, b: number, distance: number, strength: number): void => {
    const constraint = new CANNON.DistanceConstraint(particles[a] as CANNON.Body, particles[b] as CANNON.Body, distance, strength)
    physics.world.addConstraint(constraint)
    links.push(constraint)
  }

  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const here = row * columns + column
      if (column < columns - 1)
        link(here, here + 1, stepX, stiffness)
      if (row < rows - 1)
        link(here, here + columns, stepY, stiffness)
      // shear diagonals: without them the sheet has no resistance to skewing
      // and folds into creases that never come out
      if (column < columns - 1 && row < rows - 1)
        link(here, here + columns + 1, Math.hypot(stepX, stepY), stiffness * 0.25)
    }

  return links
}

/**
 * Build a cloth sheet inside an existing physics world.
 *
 * The sheet hangs in the x/y plane at `at` and falls from there. Its geometry is
 * driven by the particles every fixed step, so it collides with anything else in
 * the world and anything else in the world feels it back.
 *
 * @returns A {@link Cloth}. Add `mesh` to the scene; call `dispose()` to remove
 * the particles from the world and free the geometry.
 * @example
 * const tarp = createCloth(physics, {
 *   size: [ 3, 2 ], segments: 14, mass: 2,
 *   at: [ -1.5, 3.2, 0 ], pin: 'top-edge', wind: [ 0, 0, -6 ],
 * })
 * scene.add(tarp.mesh)
 */
export function createCloth (physics: PhysicsApi, options: ClothOptions = {}): Cloth {
  const {
    size = [ 2, 2 ],
    segments = 12,
    mass = 1,
    pin = 'top-edge',
    at = [ 0, 2, 0 ],
    nodeRadius = 0.05,
    damping = 0.08,
    gust = 0.45,
    bow = 0.02,
  } = options

  const columns  = Math.max(2, Math.round(segments) + 1)
  const rows     = columns
  const stepX    = size[0] / (columns - 1)
  const stepY    = size[1] / (rows - 1)
  const nodeMass = mass / (columns * rows)

  const geometry     = new THREE.PlaneGeometry(size[0], size[1], columns - 1, rows - 1)
  const material     = options.material ?? new THREE.MeshStandardMaterial({ color: '#8a4b2d', side: THREE.DoubleSide, roughness: 0.95 })
  const mesh         = new THREE.Mesh(geometry, material)
  mesh.castShadow    = true
  mesh.receiveShadow = true
  // the particles carry world positions, so the mesh must not add its own
  mesh.frustumCulled = false

  const grid      = { columns, rows, stepX, stepY }
  const particles = buildParticles(physics, grid, { at, pin, nodeMass, nodeRadius, damping, bow })
  const links     = buildLinks(physics, grid, particles)
  const index     = (column: number, row: number): number => row * columns + column

  const wind  = new CANNON.Vec3(...options.wind ?? [ 0, 0, 0 ])
  const force = new CANNON.Vec3()
  let elapsed = 0

  const applyWind = (delta: number): void => {
    elapsed += delta
    if (wind.almostZero())
      return

    // one shared gust envelope, plus a travelling phase per particle, so the
    // sheet ripples instead of pumping in and out as one slab
    const swell = 1 + gust * Math.sin(elapsed * 1.7)
    for (const [ i, body ] of particles.entries()) {
      if (body.mass === 0)
        continue

      const ripple = 1 + gust * 0.6 * Math.sin(elapsed * 4.3 + i * 0.7)
      const push   = swell * ripple * body.mass // acceleration → force, per particle
      force.set(wind.x * push, wind.y * push, wind.z * push)
      body.applyForce(force, body.position)
    }
  }

  const position = geometry.attributes.position as THREE.BufferAttribute

  const sync = (): void => {
    for (const [ i, body ] of particles.entries())
      position.setXYZ(i, body.position.x, body.position.y, body.position.z)

    position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  }

  const stopWind = physics.onStep(applyWind)
  const stopSync = physics.onAfterStep(sync)
  sync()

  return {
    mesh,
    particles,

    setWind (next) {
      wind.set(next[0], next[1], next[2])
    },

    unpin (column, row) {
      const body = particles[index(column, row)]
      if (body && body.mass === 0) {
        body.mass = nodeMass
        body.type = CANNON.Body.DYNAMIC
        body.updateMassProperties()
        body.wakeUp()
      }
    },

    dispose () {
      stopWind()
      stopSync()
      for (const constraint of links)
        physics.world.removeConstraint(constraint)
      for (const body of particles)
        physics.world.removeBody(body)

      geometry.dispose()
      if (!options.material)
        material.dispose()
      mesh.removeFromParent()
    },
  }
}

// perf: (segments+1)² particles and ~3× that many constraints, all solved every
// fixed step. 12 segments ≈ 169 particles / 450 constraints — cheap. 30 segments
// ≈ 961 / 2700, which will show up in a profile. Keep the grid small and let the
// normals do the detail.
