// modules/physics/world.ts
// Rigid-body physics as an app module, over cannon-es.
//
// three.js has no physics and should not grow one. cannon-es is the physics
// engine three's own manual lists that is pure ESM JavaScript with no wasm to
// fetch and no async init — which means it steps identically in a headless
// vitest run and in the browser, and a scene that uses it stays testable. It is
// an OPTIONAL peer dependency: nothing else in this package imports it, so a
// consumer who never touches physics never installs it.
//
// The module owns the step, not the caller. Physics is stepped at a FIXED rate
// with an accumulator regardless of frame rate — a variable-dt solver is
// non-deterministic and, worse, changes behaviour when the machine gets busy.
// The same seed and the same tick sequence must produce the same pile of
// barrels, or none of this repo's determinism story survives contact with a
// falling object.

import * as CANNON from 'cannon-es'
import * as THREE from 'three'

import type { AppModule, SceneContext, Vec3 } from '../../lib/index.js'


/** How a body's collision shape is derived. */
export type BodyShape = 'auto' | 'box' | 'sphere' | 'cylinder' | 'plane'

/** Options for {@link PhysicsHandle.add}. */
export interface BodyOptions {

  /**
   * Collision shape. `auto` fits a box to the object's own bounding box, which
   * is right for almost every prop and wrong for none of them badly.
   * @defaultValue `'auto'`
   */
  shape?: BodyShape

  /** Kilograms. 0 makes it static — immovable, and free to simulate. @defaultValue 0 */
  mass?: number

  /** Moved by code rather than by forces: a lift, a piston, a paddle. @defaultValue false */
  kinematic?: boolean

  /** Bounciness, 0..1. @defaultValue 0.2 */
  restitution?: number

  /** Surface friction. @defaultValue 0.4 */
  friction?: number

  /** Velocity bled off per second, 0..1. @defaultValue 0.01 */
  linearDamping?: number

  /** Spin bled off per second, 0..1. @defaultValue 0.01 */
  angularDamping?: number

  /** Override the derived box size, in metres. */
  size?: Vec3

  /** Override the derived radius (`sphere`, `cylinder`), in metres. */
  radius?: number

  /** Initial velocity, m/s. */
  velocity?: Vec3

  /** Initial spin, rad/s. */
  angularVelocity?: Vec3
}

/** Options for {@link physicsWorld}. */
export interface PhysicsWorldOptions {

  /** Acceleration, m/s². @defaultValue `[0, -9.82, 0]` */
  gravity?: Vec3

  /**
   * Fixed simulation step, in seconds. Smaller is more stable and more
   * expensive; 1/60 is the usual bargain. @defaultValue 1/60
   */
  step?: number

  /**
   * Steps a single frame may run before time is dropped. This is the spiral-of-
   * death guard: after a long stall, catching up in real time would stall
   * further. @defaultValue 4
   */
  maxSubSteps?: number

  /**
   * Constraint solver iterations. Raise it for stacks and cloth, which look
   * spongy when the solver gives up early. @defaultValue 12
   */
  iterations?: number

  /** Let resting bodies stop simulating. @defaultValue true */
  allowSleep?: boolean
}

/** Called every fixed step. `delta` is the fixed step, never the frame delta. */
export type StepCallback = (delta: number) => void

/**
 * Everything you can do to a physics world, minus the module plumbing. Helpers
 * and simulations take this rather than {@link PhysicsHandle}, so they do not
 * care what shape the app's state is.
 */
export interface PhysicsApi {

  /** The cannon-es world, for anything this wrapper does not cover. */
  readonly world: CANNON.World

  /** The fixed step, in seconds. */
  readonly fixedStep: number

  /**
   * Bind an object to a new body. The object's transform is overwritten by the
   * body's from the next step onward.
   *
   * @returns The body, for constraints, impulses, and collision events.
   */
  add (object: THREE.Object3D, options?: BodyOptions): CANNON.Body

  /** Add a body with no visual counterpart — a wall, a trigger, a floor. */
  addBody (body: CANNON.Body): CANNON.Body

  /** Remove a body and stop syncing whatever was bound to it. */
  remove (body: CANNON.Body): void

  /** Run before each fixed step: apply forces here. @returns An unsubscribe function. */
  onStep (callback: StepCallback): () => void

  /** Run after each fixed step: read results here. @returns An unsubscribe function. */
  onAfterStep (callback: StepCallback): () => void
}

/**
 * The physics module: a {@link PhysicsApi} that is also an {@link AppModule}.
 *
 * @typeParam S - The app's state type. Physics reads none of it; the parameter
 * only exists so the module drops into a typed `use: [ … ]` without a cast.
 */
export interface PhysicsHandle<S extends object = Record<string, unknown>> extends PhysicsApi, AppModule<S> {}

interface Binding {
  body:   CANNON.Body
  object: THREE.Object3D
}

function toVec3 (value: Vec3): CANNON.Vec3 {
  return new CANNON.Vec3(value[0], value[1], value[2])
}

/** Fit a collision shape to what the object actually looks like. */
function deriveShape (object: THREE.Object3D, options: BodyOptions): CANNON.Shape {
  const box  = new THREE.Box3().setFromObject(object)
  const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3())
  const half = options.size
    ? new CANNON.Vec3(options.size[0] / 2, options.size[1] / 2, options.size[2] / 2)
    : new CANNON.Vec3(Math.max(size.x, 1e-3) / 2, Math.max(size.y, 1e-3) / 2, Math.max(size.z, 1e-3) / 2)

  const radius = options.radius ?? Math.max(half.x, half.z)

  switch (options.shape ?? 'auto') {
    case 'sphere':
      return new CANNON.Sphere(options.radius ?? Math.max(half.x, half.y, half.z))
    case 'cylinder':
      return new CANNON.Cylinder(radius, radius, half.y * 2, 12)
    case 'plane':
      return new CANNON.Plane()
    default:
      return new CANNON.Box(half)
  }
}

/**
 * Rigid-body physics for a scene, as a module.
 *
 * @returns A {@link PhysicsHandle}: put it in `use: [ … ]`, then bind objects
 * to bodies with `add`.
 * @remarks Requires the optional peer dependency `cannon-es`.
 * @example
 * const physics = physicsWorld({ gravity: [ 0, -9.82, 0 ] })
 * const app = createApp(canvas, { use: [ physics ] })
 *
 * physics.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Plane() }))
 * physics.add(crate, { shape: 'box', mass: 12, restitution: 0.15 })
 */
export function physicsWorld<S extends object = Record<string, unknown>> ({
  gravity = [ 0, -9.82, 0 ],
  step = 1 / 60,
  maxSubSteps = 4,
  iterations = 12,
  allowSleep = true,
}: PhysicsWorldOptions = {}): PhysicsHandle<S> {
  const world       = new CANNON.World({ gravity: toVec3(gravity), allowSleep })
  const solver      = world.solver as CANNON.GSSolver
  world.broadphase  = new CANNON.SAPBroadphase(world)
  solver.iterations = iterations

  // One shared surface for everything, so a body's friction and bounce are
  // defined against SOMETHING. cannon only reads friction from a ContactMaterial
  // registered for the colliding PAIR — per-body `material.friction` alone is
  // silently ignored, which is the engine's most common gotcha.
  const surface                            = new CANNON.Material('default')
  world.defaultContactMaterial.friction    = 0.4
  world.defaultContactMaterial.restitution = 0.15

  const bindings: Binding[] = []
  const before              = new Set<StepCallback>()
  const after               = new Set<StepCallback>()
  let accumulator = 0

  const advance = (): void => {
    for (const callback of before)
      callback(step)

    // step(dt) alone is ONE exact step — cannon's own fixedStep() reads the
    // wall clock, which would make the simulation depend on how fast the
    // machine is. The accumulator above owns the pacing instead.
    world.step(step)

    for (const callback of after)
      callback(step)
  }

  // A body with custom friction/bounce needs a ContactMaterial against the
  // shared surface; without one, cannon falls back to the world default.
  const surfaceFor = (options: BodyOptions): CANNON.Material => {
    if (options.friction === undefined && options.restitution === undefined)
      return surface

    const material = new CANNON.Material()
    world.addContactMaterial(new CANNON.ContactMaterial(material, surface, {
      friction:    options.friction ?? 0.4,
      restitution: options.restitution ?? 0.2,
    }))
    return material
  }

  return {
    name:      'physics',
    world,
    fixedStep: step,

    build () {
      // the world needs nothing from the scene — bodies are bound by `add`
    },

    update (_state, frame) {
      // clamp before accumulating: a tab that was backgrounded for a minute must
      // not try to simulate a minute
      accumulator += Math.min(frame.delta, step * maxSubSteps)

      let steps = 0
      while (accumulator >= step && steps < maxSubSteps) {
        advance()
        accumulator -= step
        steps++
      }

      for (const { body, object } of bindings) {
        object.position.set(body.position.x, body.position.y, body.position.z)
        object.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
      }
    },

    add (object, options = {}) {
      const body = new CANNON.Body({
        mass:           options.kinematic ? 0 : options.mass ?? 0,
        shape:          deriveShape(object, options),
        material:       surfaceFor(options),
        linearDamping:  options.linearDamping ?? 0.01,
        angularDamping: options.angularDamping ?? 0.01,
      })
      if (options.kinematic)
        body.type = CANNON.Body.KINEMATIC

      body.position.set(object.position.x, object.position.y, object.position.z)
      body.quaternion.set(object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w)

      if (options.velocity)
        body.velocity.copy(toVec3(options.velocity))
      if (options.angularVelocity)
        body.angularVelocity.copy(toVec3(options.angularVelocity))

      world.addBody(body)
      bindings.push({ body, object })
      return body
    },

    addBody (body) {
      world.addBody(body)
      return body
    },

    remove (body) {
      world.removeBody(body)

      const index = bindings.findIndex(binding => binding.body === body)
      if (index >= 0)
        bindings.splice(index, 1)
    },

    onStep (callback) {
      before.add(callback)
      return () => before.delete(callback)
    },

    onAfterStep (callback) {
      after.add(callback)
      return () => after.delete(callback)
    },

    dispose () {
      for (const { body } of bindings)
        world.removeBody(body)
      bindings.length = 0
      before.clear()
      after.clear()
    },
  }
}

/**
 * A static ground plane at `y = height`.
 *
 * @returns The body, already added to the world.
 * @remarks A cannon `Plane` faces +z and is infinite, so it is rotated flat
 * here — forgetting that rotation is the classic "everything falls forever" bug.
 */
export function addGroundPlane (physics: PhysicsApi, height = 0): CANNON.Body {
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  body.position.set(0, height, 0)
  return physics.addBody(body)
}

/**
 * A static box — a wall, a ramp, a basin side.
 *
 * @param size - Full extents, in metres.
 * @returns The body, already added to the world.
 */
export function addStaticBox (physics: PhysicsApi, size: Vec3, at: Vec3, rotate: Vec3 = [ 0, 0, 0 ]): CANNON.Body {
  const body = new CANNON.Body({
    mass:  0,
    shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
  })
  body.position.set(at[0], at[1], at[2])
  body.quaternion.setFromEuler(rotate[0], rotate[1], rotate[2])
  return physics.addBody(body)
}

// perf: cost scales with (bodies × iterations). A hundred boxes at 12
// iterations is comfortably a sub-millisecond step; sleeping bodies cost
// nothing, which is why allowSleep defaults on.
