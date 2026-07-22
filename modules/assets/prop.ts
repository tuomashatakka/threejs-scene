// modules/assets/prop.ts
// A Prop is a group of child meshes treated as one authored object: build it
// once, add it to the scene, dispose it exactly once. It exists because
// disposeScene() frees EVERY material it walks, including pooled ones shared
// with other objects — disposing one prop would then blank out its neighbours.
// Prop draws the ownership line explicitly instead.

import * as THREE from 'three'

import { disposeMaterial } from '../../lib/index.js'

import type { Disposable } from '../../lib/index.js'


/**
 * Marks a geometry, material, or texture as pooled: no {@link Prop} will ever
 * dispose it. Tag anything you share across props (an atlas, a pooled material)
 * and keep ownership at the pool.
 *
 * @returns The same resource, so it can be tagged inline.
 * @example
 * const shared = markShared(createStandardMaterial('metal'))
 */
export function markShared<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture> (resource: T): T {
  resource.userData.shared = true
  return resource
}

/**
 * Ownership predicate: may a {@link Prop} dispose this resource?
 *
 * This is the whole safety question for prop teardown. Get it wrong in one
 * direction and you double-free a pooled material — every other object using it
 * renders black. Get it wrong in the other and you leak GPU memory on every
 * scene swap. The default policy is *opt-out*: a prop owns everything it
 * contains unless the resource was explicitly tagged with {@link markShared}.
 * That favours correct cleanup by default and makes sharing a deliberate,
 * visible act.
 *
 * @returns `true` when the prop should dispose the resource.
 */
export function ownsResource (resource: THREE.Material | THREE.BufferGeometry | THREE.Texture): boolean {
  return resource.userData.shared !== true
}

/**
 * A group of child meshes authored and torn down as a unit.
 *
 * Extends {@link THREE.Group}, so it is an ordinary scene-graph node — add it,
 * transform it, nest it. What it adds is named parts and a disposal contract:
 * `dispose()` frees every geometry/material/texture it owns, exactly once each,
 * and skips anything tagged with {@link markShared}.
 *
 * @example
 * const lamp = new Prop('lamp')
 * lamp.addPart('post', new THREE.Mesh(postGeo, sharedMetal))
 * lamp.addPart('bulb', new THREE.Mesh(bulbGeo, glowMat))
 * scene.add(lamp)
 * // later
 * lamp.dispose()
 */
export class Prop extends THREE.Group implements Disposable {
  #parts = new Map<string, THREE.Object3D>()
  #adopted = new Set<Disposable>()
  #disposed = false

  constructor (name = 'prop') {
    super()
    this.name = name
  }

  /**
   * Build a prop from loose objects, named `part0`, `part1`, … in order.
   *
   * @returns A new {@link Prop} containing every object.
   */
  static from (...objects: THREE.Object3D[]): Prop {
    const prop = new Prop()
    objects.forEach((object, index) => prop.addPart(`part${index}`, object))
    return prop
  }

  /** Named children, in insertion order. */
  get parts (): ReadonlyMap<string, THREE.Object3D> {
    return this.#parts
  }

  /**
   * Add a child under a name and parent it to this prop.
   *
   * @returns `this`, for chaining.
   * @throws Error when `name` is already taken — silently replacing a part
   * would orphan the old one's GPU resources.
   */
  addPart (name: string, object: THREE.Object3D): this {
    if (this.#parts.has(name))
      throw new Error(`Prop("${this.name}"): part "${name}" already exists`)
    this.#parts.set(name, object)
    this.add(object)
    return this
  }

  /**
   * Look up a named child.
   *
   * @typeParam T - Expected node type; not checked at runtime.
   */
  part<T extends THREE.Object3D = THREE.Object3D> (name: string): T | undefined {
    return this.#parts.get(name) as T | undefined
  }

  /**
   * Take ownership of a resource that is not reachable by walking the children
   * — a render target, a texture bound only to a uniform, a controller.
   *
   * @returns `this`, for chaining.
   */
  adopt (resource: Disposable): this {
    this.#adopted.add(resource)
    return this
  }

  /**
   * Free every owned geometry, material, texture, and adopted resource, then
   * detach from the parent. Idempotent — calling twice is a no-op, not a
   * double-free.
   *
   * @remarks Resources tagged with {@link markShared} are left alone; see
   * {@link ownsResource}.
   */
  dispose (): void {
    if (this.#disposed)
      return
    this.#disposed = true

    // dedupe: one material or geometry may back many meshes in the same prop
    const geometries = new Set<THREE.BufferGeometry>()
    const materials  = new Set<THREE.Material>()

    this.traverse(object => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry)
        geometries.add(mesh.geometry)
      if (mesh.material)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [ mesh.material ])
          materials.add(material)
    })

    for (const geometry of geometries)
      if (ownsResource(geometry))
        geometry.dispose()

    for (const material of materials)
      if (ownsResource(material))
        // disposeMaterial also frees the material's textures and uniform textures
        disposeMaterial(material)

    for (const resource of this.#adopted)
      resource.dispose()

    this.#adopted.clear()
    this.#parts.clear()
    this.clear()
    this.removeFromParent()
  }
}

// perf: a Prop is a plain Group — no extra draw calls, no per-frame cost. Draw
// calls scale with its mesh count; merge or instance repeated parts.
