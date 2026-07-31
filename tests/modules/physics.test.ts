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

function minimumY (object: THREE.Object3D): number {
  object.updateWorldMatrix(true, true)
  return new THREE.Box3().setFromObject(object).min.y
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

  it('grounds centered and base-pivoted geometry at the same world height', () => {
    const physics = physicsWorld({ iterations: 20 })
    addGroundPlane(physics)

    const centered = boxMesh()
    centered.position.set(-1, 4, 0)

    const basedGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const based         = new THREE.Mesh(basedGeometry, new THREE.MeshBasicMaterial())
    based.position.set(1, 4, 0)
    physics.add(centered, { mass: 1 })
    physics.add(based, { mass: 1 })

    run(physics, 3)

    expect(minimumY(centered)).toBeCloseTo(0, 1)
    expect(minimumY(based)).toBeCloseTo(0, 1)
    physics.dispose?.()
  })

  it('keeps a rotated child aligned while synchronizing through its parent', () => {
    const physics = physicsWorld({ iterations: 20 })
    addGroundPlane(physics)

    const parent = new THREE.Group()
    parent.position.set(2, 0.5, -1)
    parent.rotation.y = 0.35

    const child       = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.6), new THREE.MeshBasicMaterial())
    child.position.set(0.4, 4, -0.3)
    child.rotation.z = 0.28
    parent.add(child)
    physics.add(child, { mass: 2 })

    run(physics, 3)

    expect(minimumY(child)).toBeCloseTo(0, 1)

    const bodyPosition = physics.world.bodies.at(-1)?.position
    const visualCenter = new THREE.Box3().setFromObject(child)
      .getCenter(new THREE.Vector3())
    expect(visualCenter.distanceTo(new THREE.Vector3(bodyPosition?.x, bodyPosition?.y, bodyPosition?.z))).toBeLessThan(0.08)
    physics.dispose?.()
  })

  it('copies kinematic object transforms before every fixed step', () => {
    const physics = physicsWorld()
    const parent  = new THREE.Group()
    parent.position.set(3, 1, -2)

    const platform = boxMesh()
    platform.position.set(1, 2, 0)
    parent.add(platform)

    const body = physics.add(platform, { kinematic: true })

    run(physics, 1 / 60)
    expect(body.position.x).toBeCloseTo(4, 5)
    expect(body.position.y).toBeCloseTo(3, 5)

    platform.position.y = 4
    parent.rotation.y   = 0.5
    run(physics, 1 / 60)

    const center = new THREE.Box3().setFromObject(platform)
      .getCenter(new THREE.Vector3())
    expect(body.position.x).toBeCloseTo(center.x, 5)
    expect(body.position.y).toBeCloseTo(center.y, 5)
    physics.dispose?.()
  })

  it('binds direct children independently with addEach', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)

    const group = new THREE.Group()
    const left  = boxMesh(0.5)
    const right = boxMesh(0.5)
    left.position.set(-0.5, 2, 0)
    right.position.set(0.5, 2, 0)
    group.add(left, right)

    const bodies = physics.addEach(group, (_object, index) => ({
      mass:     1,
      velocity: [ index === 0 ? -1 : 1, 0, 0 ],
    }))

    run(physics, 1)

    expect(bodies).toHaveLength(2)
    expect(left.position.x).toBeLessThan(-1)
    expect(right.position.x).toBeGreaterThan(1)
    physics.dispose?.()
  })

  it('lets high-friction bodies lose lateral speed faster', () => {
    const slide = (friction: number): number => {
      const physics = physicsWorld({ iterations: 20 })
      addGroundPlane(physics)

      const mesh      = boxMesh()
      mesh.position.y = 0.51

      const body      = physics.add(mesh, {
        mass:           1,
        friction,
        restitution:    0,
        velocity:       [ 4, 0, 0 ],
        linearDamping:  0,
        angularDamping: 1,
      })
      run(physics, 1.25)

      const speed = Math.abs(body.velocity.x)
      physics.dispose?.()
      return speed
    }

    expect(slide(1)).toBeLessThan(slide(0) * 0.5)
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
  it('replays deterministically and stays finite for ten simulated seconds', () => {
    const simulate = (): number[] => {
      const physics = physicsWorld()
      addGroundPlane(physics)

      const liquid = createLiquid(physics, {
        count:      48,
        at:         [ 0, 1.2, 0 ],
        spawn:      [ 0.6, 0.6, 0.6 ],
        renderMode: 'particles',
        rng:        createSeededRng(17),
      })
      run(physics, 10)

      const result = liquid.particles.flatMap(body => [ body.position.x, body.position.y, body.position.z ])
      expect(result.every(Number.isFinite)).toBe(true)
      liquid.dispose()
      physics.dispose?.()
      return result
    }

    expect(simulate()).toEqual(simulate())
  })

  it('pours into a narrow basin without losing its occupied volume', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)
    for (const [ x, z ] of [[ 0.7, 0 ], [ -0.7, 0 ], [ 0, 0.7 ], [ 0, -0.7 ]] as const)
      addStaticBox(physics, [ x === 0 ? 1.6 : 0.2, 2, z === 0 ? 1.6 : 0.2 ], [ x, 1, z ])

    const liquid = createLiquid(physics, {
      count:      96,
      at:         [ 0, 1.5, 0 ],
      spawn:      [ 0.8, 0.9, 0.8 ],
      renderMode: 'particles',
      rng:        createSeededRng(7),
    })
    const initialHeight = Math.max(...liquid.particles.map(body => body.position.y)) - Math.min(...liquid.particles.map(body => body.position.y))

    run(physics, 4)

    for (const body of liquid.particles) {
      expect(Math.abs(body.position.x)).toBeLessThan(0.75)
      expect(Math.abs(body.position.z)).toBeLessThan(0.75)
      expect(body.position.y).toBeGreaterThan(-0.1)
      expect(Number.isFinite(body.position.y)).toBe(true)
    }

    const extent = (axis: 'x' | 'y' | 'z'): number =>
      Math.max(...liquid.particles.map(body => body.position[axis])) -
      Math.min(...liquid.particles.map(body => body.position[axis])) + 0.16
    const occupiedVolume = extent('x') * extent('y') * extent('z')
    const particleVolume = liquid.particles.length * 4 / 3 * Math.PI * 0.08 ** 3
    expect(initialHeight).toBeGreaterThan(0)
    expect(occupiedVolume).toBeGreaterThan(particleVolume * 0.75)
    liquid.dispose()
    physics.dispose?.()
  })

  it('sloshes laterally and transfers contact to a rigid body', () => {
    const physics = physicsWorld()
    addGroundPlane(physics)
    for (const x of [ -1.1, 1.1 ])
      addStaticBox(physics, [ 0.2, 1.5, 2.4 ], [ x, 0.75, 0 ])
    for (const z of [ -1.1, 1.1 ])
      addStaticBox(physics, [ 2.4, 1.5, 0.2 ], [ 0, 0.75, z ])

    const obstacle = boxMesh(0.35)
    obstacle.position.set(0.45, 0.7, 0)

    const obstacleBody = physics.add(obstacle, { mass: 0.25, friction: 0.1 })

    const liquid = createLiquid(physics, {
      count:      72,
      at:         [ -0.45, 1.1, 0 ],
      spawn:      [ 0.55, 0.7, 0.7 ],
      renderMode: 'particles',
      rng:        createSeededRng(3),
    })
    for (const particle of liquid.particles)
      particle.velocity.x = 1.8

    run(physics, 1.5)

    const averageX = liquid.particles.reduce((sum, body) => sum + body.position.x, 0) / liquid.particles.length
    expect(averageX).toBeGreaterThan(-0.2)
    expect(obstacleBody.position.x).toBeGreaterThan(0.45)
    liquid.dispose()
    physics.dispose?.()
  })

  it('builds a non-empty cohesive surface, resets, and cleans up', () => {
    const physics = physicsWorld()
    const before  = physics.world.bodies.length
    const liquid  = createLiquid(physics, { count: 36, rng: createSeededRng(1), resolution: 18 })
    const start   = liquid.particles.map(body => body.position.clone())

    expect(liquid.mesh.geometry.drawRange.count).toBeGreaterThan(0)
    expect(liquid.solver.density).toBeGreaterThan(0)

    run(physics, 0.2)
    expect((liquid.particles[0] as CANNON.Body).position.y).not.toBeCloseTo((start[0] as CANNON.Vec3).y, 5)
    liquid.reset()

    for (let i = 0; i < start.length; i++)
      expect((liquid.particles[i] as CANNON.Body).position.distanceTo(start[i] as CANNON.Vec3)).toBeCloseTo(0, 6)

    liquid.dispose()
    expect(physics.world.bodies.length).toBe(before)
    physics.dispose?.()
  })
})
