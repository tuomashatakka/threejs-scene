// modules/assets/materials.ts
// Tuned starting materials so scenes stop hand-setting metalness/roughness.
// Presets return a fresh material each call — share the returned instance
// across meshes rather than calling this per mesh (each distinct material
// compiles its own shader program and costs a state change per draw).

import * as THREE from 'three'

import { createMatcapTexture } from './textures.js'


/**
 * Material parameters accepted by {@link createStandardMaterial}. This is the
 * full physical-material parameter set (a superset of the standard one), so
 * overrides can reach anything — `flatShading`, `side`, maps, transmission.
 */
export type MaterialPresetParams = THREE.MeshPhysicalMaterialParameters

/**
 * Hand-tuned PBR starting points. Overrides always win over the preset.
 * `glass` is special — it resolves to a {@link THREE.MeshPhysicalMaterial} with
 * real transmission; every other preset is a {@link THREE.MeshStandardMaterial}.
 */
export const MATERIAL_PRESETS = {
  metal:    { color: '#b8bcc4', metalness: 1, roughness: 0.35 },
  chrome:   { color: '#ffffff', metalness: 1, roughness: 0.04 },
  gold:     { color: '#ffc65c', metalness: 1, roughness: 0.22 },
  plastic:  { color: '#5fb0ff', metalness: 0, roughness: 0.42 },
  rubber:   { color: '#2a2d33', metalness: 0, roughness: 0.92 },
  matte:    { color: '#c9c9c9', metalness: 0, roughness: 1 },
  emissive: { color: '#000000', metalness: 0, roughness: 1, emissive: '#79f7ff', emissiveIntensity: 2.5 },
  glass:    { color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.6, ior: 1.5, transparent: true },
} as const satisfies Record<string, MaterialPresetParams>

/** Name of a {@link MATERIAL_PRESETS} entry. */
export type MaterialPreset = keyof typeof MATERIAL_PRESETS

function isPreset (value: unknown): value is MaterialPreset {
  return typeof value === 'string' && value in MATERIAL_PRESETS
}

/**
 * Build a tuned PBR material from a preset name, a preset plus overrides, or
 * raw parameters.
 *
 * @param preset - A {@link MaterialPreset} name, or raw material parameters.
 * @param overrides - Parameters layered over the preset; these always win.
 * @returns A {@link THREE.MeshStandardMaterial}, or a {@link THREE.MeshPhysicalMaterial} for `glass`.
 * @remarks Transmission (`glass`) needs an environment map to read as glass —
 * pair it with the lighting module's IBL. Share the returned instance across
 * meshes; dispose it exactly once (see {@link Prop}'s ownership rules).
 * @example
 * createStandardMaterial('gold')
 * createStandardMaterial('plastic', { color: '#ff7ad9' })
 * createStandardMaterial({ metalness: 0.5, roughness: 0.2 })
 */
export function createStandardMaterial (
  preset: MaterialPreset | MaterialPresetParams,
  overrides: MaterialPresetParams = {},
): THREE.MeshStandardMaterial {
  const base   = isPreset(preset) ? MATERIAL_PRESETS[preset] : preset
  const params = { ...base, ...overrides }

  // transmission only exists on MeshPhysicalMaterial — route there when asked for
  if ((params.transmission ?? 0) > 0)
    return new THREE.MeshPhysicalMaterial(params as THREE.MeshPhysicalMaterialParameters)

  return new THREE.MeshStandardMaterial(params as THREE.MeshStandardMaterialParameters)
}

/** Options for {@link createToonMaterial}. */
export interface ToonMaterialOptions {
  color?: THREE.ColorRepresentation

  /** Number of quantised light bands. @defaultValue 4 */
  steps?: number
}

/**
 * Cel-shaded material backed by a quantised gradient ramp.
 *
 * @returns A {@link THREE.MeshToonMaterial} whose gradient map has `steps` hard bands.
 * @remarks The ramp uses `NearestFilter` — linear filtering would smear the
 * bands back into a smooth gradient, defeating the look.
 */
export function createToonMaterial ({ color = '#ff7ad9', steps = 4 }: ToonMaterialOptions = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: createGradientRamp(steps) })
}

/**
 * Build a quantised greyscale ramp for toon shading.
 *
 * @param steps - Number of bands. @defaultValue 4
 * @returns A {@link THREE.DataTexture} with `NearestFilter` so the bands stay crisp.
 */
export function createGradientRamp (steps = 4): THREE.DataTexture {
  const count = Math.max(2, Math.floor(steps))
  const data  = new Uint8Array(count)
  for (let i = 0; i < count; i++)
    data[i] = Math.round(i / (count - 1) * 255)

  const texture           = new THREE.DataTexture(data, count, 1, THREE.RedFormat)
  texture.minFilter       = THREE.NearestFilter
  texture.magFilter       = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate     = true
  return texture
}

/** Matcap material backed by a supplied or procedural studio-light texture. */
export function createMatcapMaterial (matcap?: THREE.Texture): THREE.MeshMatcapMaterial {
  return new THREE.MeshMatcapMaterial({ matcap: matcap ?? createMatcapTexture() })
}

// perf: cheap. One shader compile per distinct material; share instances.
