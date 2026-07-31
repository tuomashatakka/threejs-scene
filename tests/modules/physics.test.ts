import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createSeededRng } from 'Δ/state/rng'

import { addGroundPlane, addStaticBox, createCloth, createLiquid, physicsWorld } from 'ꭍ/physics'

import type { FrameContext } from 'Δ/types'
import type { PhysicsHandle } from 'ꭍ/physics'


/** Drive a physics module without an app: build once, then pump frames. */
function run (physics: PhysicsHandle, seconds: number, fps = 60): void {
  const delta = 1 / fps
  for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
    const context: FrameContext = { delta, elapsed: frame * delta, frame }
    physics.update?.({}, context, null as never)
  }
}

function boxMesh (size = 1): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial())
}


describe('physicsWorld', () => {
  it('drops a box onto the ground and lets it come to rest', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)

    const mesh = boxMesh()
    mesh.position.set(0, 5, 0)
    physics.add(mesh, { mass: 4 })

    run(physics, 3)

    expect(mesh.position.y).toBeCloseTo(0.5, 1) // resting on its own half-height
    expect(mesh.position.y).toBeGreaterThan(0.3)
    physics.dispose?.()
  })

  it('steps at a fixed rate, so frame rate does not change the outcome', () => {
    const fall = (fps: number): number => {
      const physics = physicsWorld()
      const mesh    = boxMesh()
      mesh.position.set(0, 10, 0)
      physics.add(mesh, { mass: 1 })
      run(physics, 1, fps)

      const y = mesh.position.y
      physics.dispose?.()
      return y
    }

    // 30fps runs two sub-steps per frame, 120fps runs one every other frame —
    // both must land within a step's worth of the same place
    expect(Math.abs(fall(30) - fall(60))).toBeLessThan(0.2)
    expect(Math.abs(fall(120) - fall(60))).toBeLessThan(0.2)
  })

  it('replays identically from the same start', () => {
    const positions = (): number[] => {
      const physics = physicsWorld()
      addGroundPlane(physics)

      const meshes = [ 0, 1, 2 ].map(i => {
        const mesh = boxMesh(0.6)
        mesh.position.set(i * 0.12, 1 + i * 0.8, 0)
        physics.add(mesh, { mass: 2, restitution: 0.4 })
        return mesh
      })
      run(physics, 2)

      const out = meshes.flatMap(mesh => [ mesh.position.x, mesh.position.y, mesh.position.z ])
      physics.dispose?.()
      return out
    }

    expect(positions()).toEqual(positions())
  })

  it('leaves static bodies exactly where they were put', () => {
    const physics = physicsWorld()
    const ramp    = addStaticBox(physics, [ 4, 0.2, 2 ], [ 0, 1, 0 ], [ 0, 0, -0.4 ])

    run(physics, 1)

    expect(ramp.position.y).toBe(1)
    expect(ramp.mass).toBe(0)
    physics.dispose?.()
  })

  it('runs the step hooks around every fixed step', () => {
    const physics         = physicsWorld({ step: 1 / 60 })
    const order: string[] = []

    const stopBefore = physics.onStep(() => order.push('before'))
    physics.onAfterStep(() => order.push('after'))

    run(physics, 3 / 60)
    expect(order).toEqual([ 'before', 'after', 'before', 'after', 'before', 'after' ])

    stopBefore()
    run(physics, 1 / 60)
    expect(order.at(-1)).toBe('after')
    expect(order.filter(entry => entry === 'before')).toHaveLength(3)
    physics.dispose?.()
  })

  it('detaches a removed body from its object', () => {
    const physics = physicsWorld()
    const mesh    = boxMesh()
    mesh.position.set(0, 5, 0)

    const body = physics.add(mesh, { mass: 1 })
    run(physics, 0.5)

    const fell = mesh.position.y
    expect(fell).toBeLessThan(5)

    physics.remove(body)
    run(physics, 0.5)
    expect(mesh.position.y).toBe(fell) // no longer driven
    physics.dispose?.()
  })
})

describe('createCloth', () => {
  it('hangs from its pinned edge and stretches under gravity', () => {
    const physics = physicsWorld({ iterations: 20 })
    const cloth   = createCloth(physics, { size: [ 2, 2 ], segments: 6, mass: 1, at: [ -1, 3, 0 ], pin: 'top-edge' })

    const pinned = cloth.particles[0] as CANNON.Body
    const bottom = cloth.particles[cloth.particles.length - 1] as CANNON.Body
    const start  = bottom.position.y

    run(physics, 1.5)

    expect(pinned.position.y).toBeCloseTo(3, 5) // nailed in place
    expect(bottom.position.y).toBeLessThan(start) // the rest sags
    expect(bottom.position.y).toBeGreaterThan(-2) // but does not fall off the world
    cloth.dispose()
    physics.dispose?.()
  })

  it('writes the particle positions back into the geometry', () => {
    const physics  = physicsWorld()
    const cloth    = createCloth(physics, { segments: 4, at: [ 0, 3, 0 ]})
    const position = cloth.mesh.geometry.attributes.position as THREE.BufferAttribute

    run(physics, 0.5)

    const first = cloth.particles[0] as CANNON.Body
    expect(position.getX(0)).toBeCloseTo(first.position.x, 5)
    expect(position.getY(0)).toBeCloseTo(first.position.y, 5)
    expect(cloth.mesh.geometry.attributes.normal).toBeDefined()
    cloth.dispose()
    physics.dispose?.()
  })

  it('blows sideways in a wind and hangs straight without one', () => {
    // A hanging sheet under steady wind does not settle at an offset — it
    // oscillates around one, so a single sample catches it anywhere in the
    // swing. Average the swing instead.
    const drift = (wind: [number, number, number]): number => {
      const physics = physicsWorld({ iterations: 20 })
      const cloth   = createCloth(physics, { size: [ 1.5, 1.5 ], segments: 6, mass: 0.4, at: [ 0, 3, 0 ], wind, gust: 0 })
      const hem     = cloth.particles[cloth.particles.length - 1] as CANNON.Body

      let total = 0
      for (let sample = 0; sample < 120; sample++) {
        run(physics, 1 / 60)
        total += hem.position.z
      }
      cloth.dispose()
      physics.dispose?.()
      return total / 120
    }

    expect(drift([ 0, 0, 0 ])).toBeCloseTo(0, 1)
    expect(drift([ 0, 0, -4 ])).toBeLessThan(-0.05)
  })

  it('drops what it unpins', () => {
    const physics = physicsWorld()
    const cloth   = createCloth(physics, { segments: 4, at: [ 0, 3, 0 ], pin: 'top-corners' })
    const corner  = cloth.particles[0] as CANNON.Body

    run(physics, 0.3)
    expect(corner.position.y).toBeCloseTo(3, 5)

    cloth.unpin(0, 0)
    run(physics, 0.5)
    expect(corner.position.y).toBeLessThan(3)
    cloth.dispose()
    physics.dispose?.()
  })

  it('removes its particles and constraints on dispose', () => {
    const physics = physicsWorld()
    const before  = physics.world.bodies.length
    const cloth   = createCloth(physics, { segments: 5 })

    expect(physics.world.bodies.length).toBeGreaterThan(before)
    expect(physics.world.constraints.length).toBeGreaterThan(0)

    cloth.dispose()
    expect(physics.world.bodies.length).toBe(before)
    expect(physics.world.constraints).toHaveLength(0)
    physics.dispose?.()
  })
})

describe('createLiquid', () => {
  it('pours into a basin and stays in it', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)
    for (const [ x, z ] of [[ 1.1, 0 ], [ -1.1, 0 ], [ 0, 1.1 ], [ 0, -1.1 ]] as const)
      addStaticBox(physics, [ x === 0 ? 2.4 : 0.2, 2, z === 0 ? 2.4 : 0.2 ], [ x, 1, z ])

    const liquid = createLiquid(physics, {
      count: 120,
      at:    [ 0, 2, 0 ],
      spawn: [ 0.9, 0.9, 0.9 ],
      rng:   createSeededRng(7),
    })

    run(physics, 2.5)

    for (const body of liquid.particles) {
      expect(Math.abs(body.position.x)).toBeLessThan(1.4)
      expect(Math.abs(body.position.z)).toBeLessThan(1.4)
      expect(body.position.y).toBeGreaterThan(-0.5)
      expect(Number.isFinite(body.position.y)).toBe(true)
    }

    // it settled: the column is lower and wider than it started
    const top = Math.max(...liquid.particles.map(body => body.position.y))
    expect(top).toBeLessThan(2.45)
    liquid.dispose()
    physics.dispose?.()
  })

  it('spreads out instead of collapsing to a point', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)

    const liquid = createLiquid(physics, { count: 80, at: [ 0, 1.2, 0 ], spawn: [ 0.6, 0.6, 0.6 ], rng: createSeededRng(3) })

    run(physics, 2)

    const spread = Math.max(...liquid.particles.map(body => Math.hypot(body.position.x, body.position.z)))
    expect(spread).toBeGreaterThan(0.3) // a puddle, not a pile
    liquid.dispose()
    physics.dispose?.()
  })

  it('drives one instanced mesh and cleans up after itself', () => {
    const physics = physicsWorld()
    const before  = physics.world.bodies.length
    const liquid  = createLiquid(physics, { count: 24, rng: createSeededRng(1) })

    expect(liquid.mesh.count).toBe(24)
    expect(physics.world.subsystems).toContain(liquid.sph)

    run(physics, 0.2)

    const matrix = new THREE.Matrix4()
    liquid.mesh.getMatrixAt(0, matrix)

    const at = new THREE.Vector3().setFromMatrixPosition(matrix)
    expect(at.y).toBeCloseTo((liquid.particles[0] as CANNON.Body).position.y, 5)

    liquid.dispose()
    expect(physics.world.bodies.length).toBe(before)
    expect(physics.world.subsystems).not.toContain(liquid.sph)
    physics.dispose?.()
  })
})
