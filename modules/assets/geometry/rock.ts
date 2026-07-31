import * as THREE from 'three'

import { hash3 } from '../../../lib/index.js'

import type { SeededRng, Vec3 } from '../../../lib/index.js'


export interface RockGeometryOptions {
  radius?:    number
  detail?:    number
  seed?:      number
  rng?:       SeededRng
  roughness?: number
  scale?:     Vec3
}

/** Watertight deformed icosahedron for rocks, crags, and ruin fragments. */
export function createRockGeometry ({
  radius = 0.5,
  detail = 1,
  seed = 1,
  rng,
  roughness = 0.24,
  scale = [ 1, 0.72, 1 ],
}: RockGeometryOptions = {}): THREE.BufferGeometry {
  radius = Math.max(1e-4, Math.abs(Number.isFinite(radius) ? radius : 0.5))
  detail = THREE.MathUtils.clamp(Math.round(Number.isFinite(detail) ? detail : 1), 0, 3)
  roughness = THREE.MathUtils.clamp(Number.isFinite(roughness) ? roughness : 0.24, 0, 0.8)

  const phase    = rng ? rng.range(0, 10_000) : seed
  const geometry = new THREE.IcosahedronGeometry(radius, detail)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const vertex   = new THREE.Vector3()

  for (let index = 0; index < position.count; index++) {
    vertex.fromBufferAttribute(position, index)

    const length       = Math.max(vertex.length(), 1e-6)
    const nx           = vertex.x / length
    const ny           = vertex.y / length
    const nz           = vertex.z / length
    const broad        = hash3(nx * 2.7 + phase, ny * 2.7 - phase, nz * 2.7 + phase * 0.5)
    const fine         = hash3(nx * 7.1 - phase, ny * 7.1 + phase * 0.3, nz * 7.1)
    const displacement = 1 + (broad - 0.5) * roughness * 1.5 + (fine - 0.5) * roughness * 0.5
    vertex.multiplyScalar(displacement)
    vertex.set(vertex.x * scale[0], vertex.y * scale[1], vertex.z * scale[2])
    position.setXYZ(index, vertex.x, vertex.y, vertex.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// perf: O(vertices), build-time only. Hashing positions keeps duplicated
// icosahedron corners coincident, so the shell never tears.
