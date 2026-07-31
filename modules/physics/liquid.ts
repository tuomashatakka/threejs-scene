// Cohesive liquid: cannon-es handles gravity and rigid obstacles while a
// spatial-hashed position-based fluid solver handles particle density. The two
// jobs deliberately stay separate: cannon particle/particle contacts are
// disabled because hard sphere contacts turn a fluid into a pile of marbles.

import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

import type { Disposable, SeededRng, Vec3 } from '../../lib/index.js'
import type { PhysicsApi } from './world.js'


/** Visual representation for a liquid. */
export type LiquidRenderMode = 'surface' | 'particles'

/** Live position-based-fluid tuning. */
export interface LiquidSolver {

  /** Neighbour/kernel radius in metres. Changing it recalibrates density. */
  neighborRadius: number

  /** Density-constraint passes per fixed step. */
  iterations: number

  /** XSPH velocity smoothing, 0..1. */
  viscosity: number

  /** Short-range attraction keeping the free surface together, 0..1. */
  cohesion: number

  /** Rest density calibrated from the original spawn lattice. */
  readonly density: number
}

/** Options for {@link createLiquid}. */
export interface LiquidOptions {

  /** Particle count. Spatial hashing keeps neighbour work local. @defaultValue 320 */
  count?: number

  /** Centre of the box the liquid starts in, in metres. @defaultValue `[0, 2, 0]` */
  at?: Vec3

  /** Size of that box, in metres. @defaultValue `[1, 1, 1]` */
  spawn?: Vec3

  /** Collision radius of one particle, in metres. @defaultValue 0.08 */
  radius?: number

  /** Position-based-fluid kernel radius. @defaultValue 0.24 */
  neighborRadius?: number

  /** Density-constraint passes per fixed step. @defaultValue 4 */
  iterations?: number

  /** XSPH velocity smoothing, 0..1. @defaultValue 0.02 */
  viscosity?: number

  /** Short-range attraction keeping the free surface together. @defaultValue 0.01 */
  cohesion?: number

  /** Mass per particle, in kilograms. @defaultValue 0.02 */
  mass?: number

  /** Cohesive marching-cubes surface, or instanced debug particles. @defaultValue `'surface'` */
  renderMode?: LiquidRenderMode

  /** Marching-cubes grid resolution. @defaultValue 28 */
  resolution?: number

  /** Maximum marching-cubes triangle count. @defaultValue 20000 */
  maxPolyCount?: number

  /** Deterministic spawn jitter. */
  rng?: SeededRng

  /** Material for the surface or debug particles. */
  material?: THREE.Material

  /** Colour when no material is given. @defaultValue `'#2f7293'` */
  color?: THREE.ColorRepresentation
}

/** A simulated body of liquid. */
export interface Liquid extends Disposable {

  /** Cohesive surface by default; an InstancedMesh in particle mode. */
  readonly mesh: THREE.Mesh

  /** The cannon sphere bodies used for gravity and rigid contacts. */
  readonly particles: readonly CANNON.Body[]

  /** Live position-based-fluid tuning. */
  readonly solver: LiquidSolver

  /** Drop every particle back into the calibrated spawn lattice. */
  reset (): void
}

interface SpawnLattice {
  x: Float32Array
  y: Float32Array
  z: Float32Array
}

interface LiquidRenderer {
  mesh: THREE.Mesh
  sync (): void
  dispose (): void
}

function finitePositive (value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function latticeDimensions (count: number, spawn: Vec3): [number, number, number] {
  const dimensions: [number, number, number] = [ 1, 1, 1 ]
  while (dimensions[0] * dimensions[1] * dimensions[2] < count) {
    const scoreX = spawn[0] / dimensions[0]
    const scoreY = spawn[1] / dimensions[1]
    const scoreZ = spawn[2] / dimensions[2]
    if (scoreX >= scoreY && scoreX >= scoreZ)
      dimensions[0]++
    else if (scoreY >= scoreZ)
      dimensions[1]++
    else
      dimensions[2]++
  }
  return dimensions
}

function createSpawnLattice (
  count: number,
  at: Vec3,
  spawn: Vec3,
  radius: number,
  rng?: SeededRng,
): SpawnLattice {
  const x            = new Float32Array(count)
  const y            = new Float32Array(count)
  const z            = new Float32Array(count)
  const dimensions   = latticeDimensions(count, spawn)
  const capacity     = dimensions[0] * dimensions[1] * dimensions[2]
  const usable: Vec3 = [
    Math.max(0, spawn[0] - radius * 2),
    Math.max(0, spawn[1] - radius * 2),
    Math.max(0, spawn[2] - radius * 2),
  ]
  const spacing: Vec3 = [
    dimensions[0] > 1 ? usable[0] / (dimensions[0] - 1) : 0,
    dimensions[1] > 1 ? usable[1] / (dimensions[1] - 1) : 0,
    dimensions[2] > 1 ? usable[2] / (dimensions[2] - 1) : 0,
  ]

  for (let index = 0; index < count; index++) {
    // Spread any unused slots across the whole volume instead of leaving one
    // half-filled top layer.
    const slot   = Math.floor(index * capacity / count)
    const column = slot % dimensions[0]
    const row    = Math.floor(slot / dimensions[0]) % dimensions[2]
    const layer  = Math.floor(slot / (dimensions[0] * dimensions[2]))
    const jitter = (axis: number): number => rng ? rng.range(-0.04, 0.04) * (spacing[axis] as number) : 0

    x[index] = at[0] + (column - (dimensions[0] - 1) / 2) * spacing[0] + jitter(0)
    y[index] = at[1] + (layer - (dimensions[1] - 1) / 2) * spacing[1] + jitter(1)
    z[index] = at[2] + (row - (dimensions[2] - 1) / 2) * spacing[2] + jitter(2)
  }

  return { x, y, z }
}

function hashCell (x: number, y: number, z: number): number {
  return (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) >>> 0
}

class PositionBasedFluidSolver implements LiquidSolver {
  readonly #particles:     readonly CANNON.Body[]
  readonly #mass:          number
  readonly #radius:        number
  readonly #rest:          SpawnLattice
  readonly #previousX:     Float32Array
  readonly #previousY:     Float32Array
  readonly #previousZ:     Float32Array
  readonly #x:             Float32Array
  readonly #y:             Float32Array
  readonly #z:             Float32Array
  readonly #velocityX:     Float32Array
  readonly #velocityY:     Float32Array
  readonly #velocityZ:     Float32Array
  readonly #nextVelocityX: Float32Array
  readonly #nextVelocityY: Float32Array
  readonly #nextVelocityZ: Float32Array
  readonly #lambda:        Float32Array
  readonly #correctionX:   Float32Array
  readonly #correctionY:   Float32Array
  readonly #correctionZ:   Float32Array
  readonly #cellX:         Int32Array
  readonly #cellY:         Int32Array
  readonly #cellZ:         Int32Array
  readonly #neighbors:     number[][]
  readonly #cells = new Map<number, number[]>()
  readonly #bucketPool:    number[][]
  #neighborRadius:         number
  #iterations:             number
  #viscosity:              number
  #cohesion:               number
  #density = 1
  #poly6 = 0
  #spiky = 0
  #poly6AtZero = 0

  constructor (
    particles: readonly CANNON.Body[],
    rest: SpawnLattice,
    mass: number,
    radius: number,
    neighborRadius: number,
    iterations: number,
    viscosity: number,
    cohesion: number,
  ) {
    const count          = particles.length
    this.#particles      = particles
    this.#rest           = rest
    this.#mass           = mass
    this.#radius         = radius
    this.#neighborRadius = neighborRadius
    this.#iterations     = iterations
    this.#viscosity      = viscosity
    this.#cohesion       = cohesion
    this.#previousX      = new Float32Array(count)
    this.#previousY      = new Float32Array(count)
    this.#previousZ      = new Float32Array(count)
    this.#x              = new Float32Array(count)
    this.#y              = new Float32Array(count)
    this.#z              = new Float32Array(count)
    this.#velocityX      = new Float32Array(count)
    this.#velocityY      = new Float32Array(count)
    this.#velocityZ      = new Float32Array(count)
    this.#nextVelocityX  = new Float32Array(count)
    this.#nextVelocityY  = new Float32Array(count)
    this.#nextVelocityZ  = new Float32Array(count)
    this.#lambda         = new Float32Array(count)
    this.#correctionX    = new Float32Array(count)
    this.#correctionY    = new Float32Array(count)
    this.#correctionZ    = new Float32Array(count)
    this.#cellX          = new Int32Array(count)
    this.#cellY          = new Int32Array(count)
    this.#cellZ          = new Int32Array(count)
    this.#neighbors      = Array.from({ length: count }, () => [])
    this.#bucketPool     = Array.from({ length: count }, () => [])
    this.#configureKernel()
    this.reset()
  }

  get neighborRadius (): number {
    return this.#neighborRadius
  }

  set neighborRadius (value: number) {
    this.#neighborRadius = Math.max(this.#radius * 2.01, finitePositive(value, this.#neighborRadius))
    this.#configureKernel()
  }

  get iterations (): number {
    return this.#iterations
  }

  set iterations (value: number) {
    this.#iterations = THREE.MathUtils.clamp(Math.round(Number.isFinite(value) ? value : this.#iterations), 1, 12)
  }

  get viscosity (): number {
    return this.#viscosity
  }

  set viscosity (value: number) {
    this.#viscosity = THREE.MathUtils.clamp(Number.isFinite(value) ? value : this.#viscosity, 0, 1)
  }

  get cohesion (): number {
    return this.#cohesion
  }

  set cohesion (value: number) {
    this.#cohesion = THREE.MathUtils.clamp(Number.isFinite(value) ? value : this.#cohesion, 0, 1)
  }

  get density (): number {
    return this.#density
  }

  #configureKernel (): void {
    const h           = this.#neighborRadius
    this.#poly6       = 315 / (64 * Math.PI * h ** 9)
    this.#spiky       = -45 / (Math.PI * h ** 6)
    this.#poly6AtZero = this.#poly6 * h ** 6

    let density = 0
    const h2 = h * h
    for (let i = 0; i < this.#particles.length; i++) {
      let local = this.#poly6AtZero
      for (let j = 0; j < this.#particles.length; j++) {
        if (i === j)
          continue

        const dx        = (this.#rest.x[i] as number) - (this.#rest.x[j] as number)
        const dy        = (this.#rest.y[i] as number) - (this.#rest.y[j] as number)
        const dz        = (this.#rest.z[i] as number) - (this.#rest.z[j] as number)
        const distance2 = dx * dx + dy * dy + dz * dz
        if (distance2 < h2)
          local += this.#poly6 * (h2 - distance2) ** 3
      }
      density += this.#mass * local
    }
    this.#density = Math.max(density / Math.max(1, this.#particles.length), 1e-6)
  }

  capturePrevious (): void {
    for (let i = 0; i < this.#particles.length; i++) {
      const body         = this.#particles[i] as CANNON.Body
      this.#previousX[i] = body.position.x
      this.#previousY[i] = body.position.y
      this.#previousZ[i] = body.position.z
    }
  }

  #buildNeighbors (): void {
    this.#cells.clear()

    let usedBuckets = 0
    const inverseCell = 1 / this.#neighborRadius

    for (let i = 0; i < this.#particles.length; i++) {
      const cellX    = Math.floor((this.#x[i] as number) * inverseCell)
      const cellY    = Math.floor((this.#y[i] as number) * inverseCell)
      const cellZ    = Math.floor((this.#z[i] as number) * inverseCell)
      this.#cellX[i] = cellX
      this.#cellY[i] = cellY
      this.#cellZ[i] = cellZ

      const key      = hashCell(cellX, cellY, cellZ)
      let bucket = this.#cells.get(key)
      if (!bucket) {
        bucket = this.#bucketPool[usedBuckets++] as number[]
        bucket.length = 0
        this.#cells.set(key, bucket)
      }
      bucket.push(i)
      this.#neighbors[i]!.length = 0
    }

    const h2 = this.#neighborRadius * this.#neighborRadius
    for (let i = 0; i < this.#particles.length; i++) {
      const neighbors = this.#neighbors[i] as number[]
      for (let z = -1; z <= 1; z++)
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++) {
            const cellX  = (this.#cellX[i] as number) + x
            const cellY  = (this.#cellY[i] as number) + y
            const cellZ  = (this.#cellZ[i] as number) + z
            const bucket = this.#cells.get(hashCell(cellX, cellY, cellZ))
            if (!bucket)
              continue

            for (const candidate of bucket) {
              if (candidate === i || this.#cellX[candidate] !== cellX || this.#cellY[candidate] !== cellY || this.#cellZ[candidate] !== cellZ)
                continue

              const dx = (this.#x[i] as number) - (this.#x[candidate] as number)
              const dy = (this.#y[i] as number) - (this.#y[candidate] as number)
              const dz = (this.#z[i] as number) - (this.#z[candidate] as number)
              if (dx * dx + dy * dy + dz * dz < h2)
                neighbors.push(candidate)
            }
          }
    }
  }

  solve (delta: number): void {
    const dt = finitePositive(delta, 1 / 60)
    for (let i = 0; i < this.#particles.length; i++) {
      const body = this.#particles[i] as CANNON.Body
      this.#x[i] = Number.isFinite(body.position.x) ? body.position.x : this.#previousX[i] as number
      this.#y[i] = Number.isFinite(body.position.y) ? body.position.y : this.#previousY[i] as number
      this.#z[i] = Number.isFinite(body.position.z) ? body.position.z : this.#previousZ[i] as number
    }

    this.#buildNeighbors()

    const h                 = this.#neighborRadius
    const h2                = h * h
    const q                 = h * 0.3
    const pressureReference = Math.max(this.#poly6 * (h2 - q * q) ** 3, 1e-6)
    const correctionCap     = Math.min(this.#radius * 0.5, h * 0.2)

    for (let iteration = 0; iteration < this.#iterations; iteration++) {
      for (let i = 0; i < this.#particles.length; i++) {
        let localDensity = this.#poly6AtZero
        let gradientX    = 0
        let gradientY    = 0
        let gradientZ    = 0
        let denominator  = 0

        for (const j of this.#neighbors[i] as number[]) {
          const dx        = (this.#x[i] as number) - (this.#x[j] as number)
          const dy        = (this.#y[i] as number) - (this.#y[j] as number)
          const dz        = (this.#z[i] as number) - (this.#z[j] as number)
          const distance2 = dx * dx + dy * dy + dz * dz
          if (distance2 >= h2)
            continue
          localDensity += this.#poly6 * (h2 - distance2) ** 3

          const distance      = Math.sqrt(Math.max(distance2, 1e-12))
          const gradientScale = this.#spiky * (h - distance) ** 2 / (distance * this.#density)
          const gx            = dx * gradientScale
          const gy            = dy * gradientScale
          const gz            = dz * gradientScale
          gradientX += gx
          gradientY += gy
          gradientZ += gz
          denominator += gx * gx + gy * gy + gz * gz
        }

        denominator += gradientX * gradientX + gradientY * gradientY + gradientZ * gradientZ

        const constraint = Math.max(this.#mass * localDensity / this.#density - 1, -0.1)
        this.#lambda[i]  = THREE.MathUtils.clamp(-constraint / (denominator + 1e-5), -0.5, 0.5)
      }

      for (let i = 0; i < this.#particles.length; i++) {
        let correctionX = 0
        let correctionY = 0
        let correctionZ = 0
        const neighbors = this.#neighbors[i] as number[]

        for (const j of neighbors) {
          const dx        = (this.#x[i] as number) - (this.#x[j] as number)
          const dy        = (this.#y[i] as number) - (this.#y[j] as number)
          const dz        = (this.#z[i] as number) - (this.#z[j] as number)
          const distance2 = dx * dx + dy * dy + dz * dz
          if (distance2 >= h2)
            continue

          const distance           = Math.sqrt(Math.max(distance2, 1e-12))
          const kernel             = this.#poly6 * (h2 - distance2) ** 3
          const artificialPressure = -0.001 * (kernel / pressureReference) ** 4
          const gradientScale      = this.#spiky * (h - distance) ** 2 / distance
          const pressureScale      = ((this.#lambda[i] as number) + (this.#lambda[j] as number) + artificialPressure) / this.#density
          correctionX += dx * gradientScale * pressureScale
          correctionY += dy * gradientScale * pressureScale
          correctionZ += dz * gradientScale * pressureScale

          const attraction = this.#cohesion * h * 0.05 * (1 - distance / h) / Math.max(1, neighbors.length)
          correctionX -= dx / distance * attraction
          correctionY -= dy / distance * attraction
          correctionZ -= dz / distance * attraction
        }

        const length         = Math.hypot(correctionX, correctionY, correctionZ)
        const scale          = length > correctionCap ? correctionCap / length : 1
        this.#correctionX[i] = correctionX * scale
        this.#correctionY[i] = correctionY * scale
        this.#correctionZ[i] = correctionZ * scale
      }

      for (let i = 0; i < this.#particles.length; i++) {
        this.#x[i] = (this.#x[i] as number) + (this.#correctionX[i] as number)
        this.#y[i] = (this.#y[i] as number) + (this.#correctionY[i] as number)
        this.#z[i] = (this.#z[i] as number) + (this.#correctionZ[i] as number)
      }
    }

    const maximumSpeed = Math.max(5, h / dt * 2)
    for (let i = 0; i < this.#particles.length; i++) {
      let vx = ((this.#x[i] as number) - (this.#previousX[i] as number)) / dt
      let vy = ((this.#y[i] as number) - (this.#previousY[i] as number)) / dt
      let vz = ((this.#z[i] as number) - (this.#previousZ[i] as number)) / dt
      const speed = Math.hypot(vx, vy, vz)
      if (speed > maximumSpeed) {
        const scale = maximumSpeed / speed
        vx *= scale
        vy *= scale
        vz *= scale
      }
      this.#velocityX[i] = vx
      this.#velocityY[i] = vy
      this.#velocityZ[i] = vz
    }

    for (let i = 0; i < this.#particles.length; i++) {
      const neighbors = this.#neighbors[i] as number[]
      let totalWeight = 0
      let averageX    = 0
      let averageY    = 0
      let averageZ    = 0
      for (const j of neighbors) {
        const dx        = (this.#x[i] as number) - (this.#x[j] as number)
        const dy        = (this.#y[i] as number) - (this.#y[j] as number)
        const dz        = (this.#z[i] as number) - (this.#z[j] as number)
        const distance2 = dx * dx + dy * dy + dz * dz
        if (distance2 >= h2)
          continue

        const weight = this.#poly6 * (h2 - distance2) ** 3
        totalWeight += weight
        averageX += (this.#velocityX[j] as number) * weight
        averageY += (this.#velocityY[j] as number) * weight
        averageZ += (this.#velocityZ[j] as number) * weight
      }

      const blend            = totalWeight > 0 ? this.#viscosity : 0
      this.#nextVelocityX[i] = THREE.MathUtils.lerp(this.#velocityX[i] as number, averageX / Math.max(totalWeight, 1e-9), blend)
      this.#nextVelocityY[i] = THREE.MathUtils.lerp(this.#velocityY[i] as number, averageY / Math.max(totalWeight, 1e-9), blend)
      this.#nextVelocityZ[i] = THREE.MathUtils.lerp(this.#velocityZ[i] as number, averageZ / Math.max(totalWeight, 1e-9), blend)
    }

    for (let i = 0; i < this.#particles.length; i++) {
      const body = this.#particles[i] as CANNON.Body
      body.position.set(this.#x[i] as number, this.#y[i] as number, this.#z[i] as number)
      body.velocity.set(this.#nextVelocityX[i] as number, this.#nextVelocityY[i] as number, this.#nextVelocityZ[i] as number)
      body.interpolatedPosition.copy(body.position)
      body.aabbNeedsUpdate = true
      body.updateAABB()
    }
  }

  reset (): void {
    for (let i = 0; i < this.#particles.length; i++) {
      const body = this.#particles[i] as CANNON.Body
      const x    = this.#rest.x[i] as number
      const y    = this.#rest.y[i] as number
      const z    = this.#rest.z[i] as number
      body.position.set(x, y, z)
      body.previousPosition.set(x, y, z)
      body.interpolatedPosition.set(x, y, z)
      body.velocity.setZero()
      body.angularVelocity.setZero()
      body.aabbNeedsUpdate = true
      body.wakeUp()
      this.#previousX[i] = x
      this.#previousY[i] = y
      this.#previousZ[i] = z
    }
  }
}

function createParticleRenderer (
  particles: readonly CANNON.Body[],
  radius: number,
  material: THREE.Material,
  ownsMaterial: boolean,
): LiquidRenderer {
  const geometry     = new THREE.IcosahedronGeometry(radius, 1)
  const mesh         = new THREE.InstancedMesh(geometry, material, particles.length)
  const dummy        = new THREE.Object3D()
  mesh.castShadow    = true
  mesh.frustumCulled = false

  const sync = (): void => {
    for (let i = 0; i < particles.length; i++) {
      const body = particles[i] as CANNON.Body
      dummy.position.set(body.position.x, body.position.y, body.position.z)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  return {
    mesh,
    sync,
    dispose () {
      geometry.dispose()
      if (ownsMaterial)
        material.dispose()
      mesh.dispose()
      mesh.removeFromParent()
    },
  }
}

function createSurfaceRenderer (
  particles: readonly CANNON.Body[],
  radius: number,
  neighborRadius: () => number,
  resolution: number,
  maxPolyCount: number,
  material: THREE.Material,
  ownsMaterial: boolean,
): LiquidRenderer {
  const mesh         = new MarchingCubes(resolution, material, false, false, maxPolyCount)
  mesh.castShadow    = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false

  const sync = (): void => {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const body of particles) {
      minX = Math.min(minX, body.position.x)
      minY = Math.min(minY, body.position.y)
      minZ = Math.min(minZ, body.position.z)
      maxX = Math.max(maxX, body.position.x)
      maxY = Math.max(maxY, body.position.y)
      maxZ = Math.max(maxZ, body.position.z)
    }

    const padding = Math.max(radius * 2, neighborRadius() * 0.55)
    minX -= padding
    minY -= padding
    minZ -= padding
    maxX += padding
    maxY += padding
    maxZ += padding

    const sizeX       = Math.max(maxX - minX, radius * 4)
    const sizeY       = Math.max(maxY - minY, radius * 4)
    const sizeZ       = Math.max(maxZ - minZ, radius * 4)
    const maximumSize = Math.max(sizeX, sizeY, sizeZ)

    mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
    mesh.scale.set(sizeX / 2, sizeY / 2, sizeZ / 2)
    mesh.reset()

    const subtract         = 12
    const normalizedRadius = Math.max(0.02, radius * 1.55 / maximumSize)
    const strength         = (mesh.isolation + subtract) * normalizedRadius * normalizedRadius
    for (const body of particles)
      mesh.addBall(
        THREE.MathUtils.clamp((body.position.x - minX) / sizeX, 0.03, 0.97),
        THREE.MathUtils.clamp((body.position.y - minY) / sizeY, 0.03, 0.97),
        THREE.MathUtils.clamp((body.position.z - minZ) / sizeZ, 0.03, 0.97),
        strength,
        subtract,
      )
    mesh.update()
  }

  return {
    mesh,
    sync,
    dispose () {
      mesh.geometry.dispose()
      if (ownsMaterial)
        material.dispose()
      mesh.removeFromParent()
    },
  }
}

/**
 * Fill a box with position-based fluid inside an existing physics world.
 *
 * @returns A {@link Liquid}. Add `mesh` to the scene; `dispose()` removes every
 * particle and renderer resource.
 */
export function createLiquid (physics: PhysicsApi, options: LiquidOptions = {}): Liquid {
  const count       = THREE.MathUtils.clamp(Math.round(finitePositive(options.count ?? 320, 320)), 1, 5000)
  const at          = options.at ?? [ 0, 2, 0 ]
  const radius      = finitePositive(options.radius ?? 0.08, 0.08)
  const spawn: Vec3 = [
    finitePositive(options.spawn?.[0] ?? 1, 1),
    finitePositive(options.spawn?.[1] ?? 1, 1),
    finitePositive(options.spawn?.[2] ?? 1, 1),
  ]
  const neighborRadius           = Math.max(radius * 2.01, finitePositive(options.neighborRadius ?? 0.24, 0.24))
  const iterations               = THREE.MathUtils.clamp(Math.round(options.iterations ?? 4), 1, 12)
  const viscosity                = THREE.MathUtils.clamp(options.viscosity ?? 0.02, 0, 1)
  const cohesion                 = THREE.MathUtils.clamp(options.cohesion ?? 0.01, 0, 1)
  const mass                     = finitePositive(options.mass ?? 0.02, 0.02)
  const rest                     = createSpawnLattice(count, at, spawn, radius, options.rng)
  const fluidMaterial            = new CANNON.Material({ friction: 0, restitution: 0 })
  const shape                    = new CANNON.Sphere(radius)
  const particles: CANNON.Body[] = []

  for (let i = 0; i < count; i++) {
    const body = new CANNON.Body({
      mass,
      shape,
      material:      fluidMaterial,
      linearDamping: 0.01,
    })
    body.collisionFilterGroup = 4
    body.collisionFilterMask  = 1
    body.allowSleep           = false
    physics.addBody(body)
    particles.push(body)
  }

  const solver = new PositionBasedFluidSolver(
    particles,
    rest,
    mass,
    radius,
    neighborRadius,
    iterations,
    viscosity,
    cohesion,
  )
  const ownsMaterial = !options.material
  const material     = options.material ?? new THREE.MeshPhysicalMaterial({
    color:       options.color ?? '#2f7293',
    roughness:   0.18,
    metalness:   0.05,
    clearcoat:   0.45,
    transparent: true,
    opacity:     0.88,
    depthWrite:  true,
  })
  const renderer = options.renderMode === 'particles'
    ? createParticleRenderer(particles, radius, material, ownsMaterial)
    : createSurfaceRenderer(
      particles,
      radius,
      () => solver.neighborRadius,
      THREE.MathUtils.clamp(Math.round(options.resolution ?? 28), 12, 64),
      Math.max(1000, Math.round(options.maxPolyCount ?? 20_000)),
      material,
      ownsMaterial,
    )

  const stopBefore = physics.onStep(() => solver.capturePrevious())
  const stopAfter  = physics.onAfterStep(delta => {
    solver.solve(delta)
    renderer.sync()
  })
  renderer.sync()

  let disposed = false

  return {
    mesh: renderer.mesh,
    particles,
    solver,

    reset () {
      solver.reset()
      renderer.sync()
    },

    dispose () {
      if (disposed)
        return
      disposed = true
      stopBefore()
      stopAfter()
      for (const body of particles)
        physics.world.removeBody(body)
      renderer.dispose()
    },
  }
}

// perf: neighbour lookup is O(n) average plus O(nk) local constraints. Arrays,
// neighbour lists, and hash buckets are allocated once; marching cubes is one
// draw call and reuses its typed buffers each fixed step.
