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

  /**
   * Override the collider centre in object-local coordinates. By default it is
   * derived from all descendant mesh bounds. This is useful for invisible or
   * deliberately asymmetric collision volumes.
   */
  center?: Vec3

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

  /**
   * Bind every direct child of a root, or every object in an array, as an
   * independent body. Unlike {@link add}, this never creates one compound
   * rigid body for a group.
   */
  addEach (
    rootOrObjects: THREE.Object3D | readonly THREE.Object3D[],
    optionsOrResolver?: BodyOptions | ((object: THREE.Object3D, index: number) => BodyOptions),
  ): CANNON.Body[]

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
  body:       CANNON.Body
  object:     THREE.Object3D
  center:     THREE.Vector3
  worldScale: THREE.Vector3
  kinematic:  boolean
}

interface DerivedBounds {
  center:     THREE.Vector3
  localSize:  THREE.Vector3
  worldScale: THREE.Vector3
}

const _bounds           = new THREE.Box3()
const _childBounds      = new THREE.Box3()
const _inverseRoot      = new THREE.Matrix4()
const _relativeMatrix   = new THREE.Matrix4()
const _worldPosition    = new THREE.Vector3()
const _worldQuaternion  = new THREE.Quaternion()
const _parentQuaternion = new THREE.Quaternion()
const _scaledCenter     = new THREE.Vector3()
const _parentInverse    = new THREE.Matrix4()

function toVec3 (value: Vec3): CANNON.Vec3 {
  return new CANNON.Vec3(value[0], value[1], value[2])
}

/** Bounds in root-local space, with the root's world scale frozen at binding. */
function deriveBounds (object: THREE.Object3D, options: BodyOptions): DerivedBounds {
  object.updateWorldMatrix(true, true)
  _inverseRoot.copy(object.matrixWorld).invert()
  _bounds.makeEmpty()

  object.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.geometry)
      return

    if (!mesh.geometry.boundingBox)
      mesh.geometry.computeBoundingBox()
    if (!mesh.geometry.boundingBox || mesh.geometry.boundingBox.isEmpty())
      return

    _relativeMatrix.multiplyMatrices(_inverseRoot, child.matrixWorld)
    _childBounds.copy(mesh.geometry.boundingBox).applyMatrix4(_relativeMatrix)
    _bounds.union(_childBounds)
  })

  const center = options.center
    ? new THREE.Vector3(options.center[0], options.center[1], options.center[2])
    : _bounds.isEmpty() ? new THREE.Vector3() : _bounds.getCenter(new THREE.Vector3())
  const localSize = options.size
    ? new THREE.Vector3(options.size[0], options.size[1], options.size[2])
    : _bounds.isEmpty() ? new THREE.Vector3(1, 1, 1) : _bounds.getSize(new THREE.Vector3())
  const worldScale = object.getWorldScale(new THREE.Vector3())
  worldScale.set(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z))

  return { center, localSize, worldScale }
}

/** Fit a collision shape to what the object actually looks like. */
function deriveShape ({ localSize, worldScale }: DerivedBounds, options: BodyOptions): CANNON.Shape {
  const size = localSize.clone().multiply(worldScale)
  const half = new CANNON.Vec3(
    Math.max(size.x, 1e-3) / 2,
    Math.max(size.y, 1e-3) / 2,
    Math.max(size.z, 1e-3) / 2,
  )

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

function readObjectWorldPose (binding: Binding): void {
  const { body, center, object, worldScale } = binding
  object.updateWorldMatrix(true, false)
  object.getWorldPosition(_worldPosition)
  object.getWorldQuaternion(_worldQuaternion)
  _scaledCenter.copy(center).multiply(worldScale)
    .applyQuaternion(_worldQuaternion)
  _worldPosition.add(_scaledCenter)
  body.position.set(_worldPosition.x, _worldPosition.y, _worldPosition.z)
  body.quaternion.set(_worldQuaternion.x, _worldQuaternion.y, _worldQuaternion.z, _worldQuaternion.w)
  body.aabbNeedsUpdate = true
}

function writeBodyWorldPose (binding: Binding): void {
  const { body, center, object, worldScale } = binding
  _worldQuaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
  _scaledCenter.copy(center).multiply(worldScale)
    .applyQuaternion(_worldQuaternion)
  _worldPosition.set(body.position.x, body.position.y, body.position.z).sub(_scaledCenter)

  if (object.parent) {
    object.parent.updateWorldMatrix(true, false)
    _parentInverse.copy(object.parent.matrixWorld).invert()
    object.position.copy(_worldPosition).applyMatrix4(_parentInverse)
    object.parent.getWorldQuaternion(_parentQuaternion).invert()
    object.quaternion.copy(_parentQuaternion.multiply(_worldQuaternion))
  }
  else {
    object.position.copy(_worldPosition)
    object.quaternion.copy(_worldQuaternion)
  }

  object.updateMatrix()
  object.updateMatrixWorld(true)
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

  // cannon multiplies the two bodies' material coefficients when both are
  // present. Static surfaces therefore use neutral coefficients: the authored
  // value on the moving body survives contact unchanged.
  const surface                            = new CANNON.Material({ friction: 1, restitution: 1 })
  const defaults                           = new CANNON.Material({ friction: 0.4, restitution: 0.2 })
  surface.name                             = 'surface'
  defaults.name                            = 'body-default'
  world.defaultContactMaterial.friction    = 0.4
  world.defaultContactMaterial.restitution = 0.15

  const bindings: Binding[] = []
  const before              = new Set<StepCallback>()
  const after               = new Set<StepCallback>()
  let accumulator = 0

  const advance = (): void => {
    for (const binding of bindings)
      if (binding.kinematic)
        readObjectWorldPose(binding)

    for (const callback of before)
      callback(step)

    // step(dt) alone is ONE exact step — cannon's own fixedStep() reads the
    // wall clock, which would make the simulation depend on how fast the
    // machine is. The accumulator above owns the pacing instead.
    world.step(step)

    for (const binding of bindings)
      if (!binding.kinematic)
        writeBodyWorldPose(binding)

    for (const callback of after)
      callback(step)
  }

  const materialFor = (options: BodyOptions, staticBody: boolean): CANNON.Material => {
    if (options.friction === undefined && options.restitution === undefined)
      return staticBody ? surface : defaults

    return new CANNON.Material({
      friction:    Math.max(0, options.friction ?? 0.4),
      restitution: THREE.MathUtils.clamp(options.restitution ?? 0.2, 0, 1),
    })
  }

  const add = (object: THREE.Object3D, options: BodyOptions = {}): CANNON.Body => {
    const bounds     = deriveBounds(object, options)
    const staticBody = !options.kinematic && (options.mass ?? 0) === 0
    const body       = new CANNON.Body({
      mass:           options.kinematic ? 0 : options.mass ?? 0,
      shape:          deriveShape(bounds, options),
      material:       materialFor(options, staticBody),
      linearDamping:  THREE.MathUtils.clamp(options.linearDamping ?? 0.01, 0, 1),
      angularDamping: THREE.MathUtils.clamp(options.angularDamping ?? 0.01, 0, 1),
    })
    if (options.kinematic)
      body.type = CANNON.Body.KINEMATIC

    const binding: Binding = {
      body,
      object,
      center:     bounds.center,
      worldScale: bounds.worldScale,
      kinematic:  options.kinematic === true,
    }
    readObjectWorldPose(binding)

    if (options.velocity)
      body.velocity.copy(toVec3(options.velocity))
    if (options.angularVelocity)
      body.angularVelocity.copy(toVec3(options.angularVelocity))

    world.addBody(body)
    bindings.push(binding)
    return body
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
    },

    add,

    addEach (rootOrObjects, optionsOrResolver = {}) {
      const objects = rootOrObjects instanceof THREE.Object3D
        ? rootOrObjects.children.length > 0 ? [ ...rootOrObjects.children ] : [ rootOrObjects ]
        : rootOrObjects

      return objects.map((object, index) => add(
        object,
        typeof optionsOrResolver === 'function' ? optionsOrResolver(object, index) : optionsOrResolver,
      ))
    },

    addBody (body) {
      if (!body.material)
        body.material = body.mass === 0 ? surface : defaults
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
