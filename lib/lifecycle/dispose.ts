// lib/lifecycle/dispose.ts
// Recursive scene cleanup. Three.js does NOT auto-dispose — call this on
// teardown, route change, or quality-tier change to free GPU memory.

import type * as THREE from 'three'


function isTexture (val: unknown): val is THREE.Texture {
  return Boolean(
    val &&
    typeof val === 'object' &&
    'minFilter' in val &&
    typeof (val as { dispose?: unknown }).dispose === 'function',
  )
}

/**
 * Dispose a material and every texture it references. Frees all Texture-shaped
 * properties (`map`, `normalMap`, …), every texture-valued shader uniform, and
 * finally the material itself.
 */
export function disposeMaterial (mat: THREE.Material): void {
  const textures = new Set<THREE.Texture>()

  // dispose every Texture-shaped property
  for (const key in mat) {
    const val = (mat as unknown as Record<string, unknown>)[key]
    if (isTexture(val))
      textures.add(val)
  }

  // dispose every uniform whose value is a Texture
  const shaderMat = mat as THREE.ShaderMaterial
  if (shaderMat.uniforms)
    for (const key in shaderMat.uniforms) {
      const val = shaderMat.uniforms[key]?.value
      if (isTexture(val))
        textures.add(val)
    }

  for (const texture of textures)
    if (texture.userData.shared !== true)
      texture.dispose()

  mat.dispose()
}

/**
 * Recursively free GPU resources under `root`: every geometry plus every
 * material (and its textures, via {@link disposeMaterial}). Call on teardown —
 * three.js never auto-disposes.
 *
 * @remarks Disposes everything it finds, including shared/pooled materials, so
 * keep pooled resources out of trees you pass here. Does not detach `root`
 * from its parent.
 */
export function disposeScene (root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry)
      mesh.geometry.dispose()
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
      for (const mat of materials)
        disposeMaterial(mat)
    }
  })
}

/** Options for {@link disposeMesh}. */
export interface DisposeMeshOptions {

  /**
   * Leave the material alone.
   *
   * Set it for anything pooled. One material shared between props is the whole
   * point of a kit — and disposing it from one owner's teardown blanks every
   * other mesh still using it, which reads as a rendering bug rather than as a
   * lifecycle one. @defaultValue false
   */
  keepMaterial?: boolean
}

/**
 * Detach one mesh from its parent and free what it owns.
 *
 * The complement to {@link disposeScene}, which walks a whole tree and
 * deliberately leaves `root` attached. A module that built one mesh wants the
 * opposite: detach this, drop its geometry, drop its material unless the
 * material is pooled. Written out by hand that is three or four lines that
 * every such teardown repeats, and the line most often forgotten is the first
 * one — a disposed mesh left in the graph still gets traversed.
 */
export function disposeMesh (mesh: THREE.Mesh, options: DisposeMeshOptions = {}): void {
  mesh.removeFromParent()
  mesh.geometry?.dispose()

  if (options.keepMaterial || !mesh.material)
    return

  const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]

  for (const mat of materials)
    disposeMaterial(mat)
}

// perf: cheap. Call once on teardown. Without this, GPU memory leaks across
// scene swaps.
