import * as THREE from 'three'

import { mulberry32 } from '../../lib/index.js'

import { createProp } from './create.js'

import type { CreatePropInput } from './create.js'


export type InstancePlace = (index: number, random: () => number, transform: THREE.Object3D) => void

export interface InstancedPropOptions {
  count:    number
  radius?:  number
  seed?:    number
  options?: Readonly<Record<string, unknown>>
  place?:   InstancePlace
}

export interface InstancedPropResult {
  readonly object: THREE.Object3D
  readonly meshes: readonly THREE.InstancedMesh[]
  dispose (): void
}

const placement      = new THREE.Object3D()
const instanceMatrix = new THREE.Matrix4()

/** Instance every mesh part of one procedural prop without cloning groups. */
export function createInstancedProp (
  input: CreatePropInput,
  {
    count,
    radius = 10,
    seed = 1,
    options = {},
    place,
  }: InstancedPropOptions,
): InstancedPropResult {
  count = THREE.MathUtils.clamp(Math.round(Number.isFinite(count) ? count : 1), 1, 100_000)
  radius = Math.max(0, Number.isFinite(radius) ? radius : 10)

  const sample = createProp(input, options)
  sample.updateWorldMatrix(true, true)

  const sources: THREE.Mesh[] = []
  sample.traverse(object => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh))
      sources.push(object)
  })
  if (sources.length === 0) {
    sample.dispose()
    throw new Error('createInstancedProp: prop contains no mesh parts')
  }

  const random                      = mulberry32(seed)
  const transforms: THREE.Matrix4[] = []
  for (let index = 0; index < count; index++) {
    placement.position.set(0, 0, 0)
    placement.quaternion.identity()
    placement.scale.set(1, 1, 1)
    if (place)
      place(index, random, placement)
    else {
      const angle    = random() * Math.PI * 2
      const distance = Math.sqrt(random()) * radius
      placement.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)
      placement.rotation.y = random() * Math.PI * 2
    }
    placement.updateMatrix()
    transforms.push(placement.matrix.clone())
  }

  const meshes = sources.map(source => {
    const mesh         = new THREE.InstancedMesh(source.geometry, source.material, count)
    mesh.name          = source.name
    mesh.castShadow    = source.castShadow
    mesh.receiveShadow = source.receiveShadow
    for (let index = 0; index < count; index++) {
      instanceMatrix.multiplyMatrices(transforms[index] as THREE.Matrix4, source.matrixWorld)
      mesh.setMatrixAt(index, instanceMatrix)
    }
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  })
  const object: THREE.Object3D = meshes.length === 1
    ? meshes[0] as THREE.InstancedMesh
    : new THREE.Group().add(...meshes)
  let disposed = false

  return {
    object,
    meshes,
    dispose () {
      if (disposed)
        return
      disposed = true
      object.removeFromParent()
      for (const mesh of meshes)
        mesh.dispose()
      sample.dispose()
    },
  }
}

// perf: one draw call per mesh part regardless of instance count. Placement
// matrices allocate once at build; no per-frame work.
