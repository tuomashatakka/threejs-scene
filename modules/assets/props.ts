// modules/assets/props.ts
// A small catalogue of ready-made props, built from the material factories.
// Every factory is deterministic: pass the same rng (or none) and you get the
// same geometry, so scenes replay identically. Each returns a Prop that owns
// what it built — call dispose() when you remove it.

import * as THREE from 'three'

import { Prop } from './prop.js'
import { createStandardMaterial } from './materials.js'

import type { SeededRng } from '../../lib/index.js'


/** Shared options for the prop factories. */
export interface PropOptions {

  /** Deterministic randomness. Omit for the canonical (unvaried) form. */
  rng?: SeededRng

  /** Uniform scale applied to the built prop. @defaultValue 1 */
  scale?: number
}

function jitter (rng: SeededRng | undefined, amount: number): number {
  return rng ? rng.range(-amount, amount) : 0
}

function finish (prop: Prop, scale: number): Prop {
  if (scale !== 1)
    prop.scale.setScalar(scale)
  return prop
}

/** Options for {@link crystalProp}. */
export interface CrystalOptions extends PropOptions {
  color?: THREE.ColorRepresentation

  /** Emissive gain; raise above 1 to make it bloom. @defaultValue 2.5 */
  glow?: number
}

/**
 * A faceted crystal shard with an emissive core — the canonical "glowing pickup".
 *
 * @returns A {@link Prop} with parts `shell` and `core`.
 * @remarks The core is emissive above 1 so a bloom pass picks it up.
 */
export function crystalProp ({ rng, scale = 1, color = '#79f7ff', glow = 2.5 }: CrystalOptions = {}): Prop {
  const prop = new Prop('crystal')

  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5 + jitter(rng, 0.08), 0),
    createStandardMaterial('glass', { color, thickness: 0.35, roughness: 0.08 }),
  )
  shell.scale.y = 1.8 + jitter(rng, 0.3)

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    createStandardMaterial('emissive', { emissive: color, emissiveIntensity: glow }),
  )
  core.scale.y = 1.8

  return finish(prop.addPart('shell', shell).addPart('core', core), scale)
}

/** Options for {@link rockProp}. */
export interface RockOptions extends PropOptions {
  color?: THREE.ColorRepresentation
}

/**
 * A low-poly boulder — flat-shaded, vertex-displaced, no two alike when seeded.
 *
 * @returns A {@link Prop} with a single part `body`.
 */
export function rockProp ({ rng, scale = 1, color = '#6b6f78' }: RockOptions = {}): Prop {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const vertex   = new THREE.Vector3()

  // push each vertex along its own direction for an irregular silhouette
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i)
    vertex.multiplyScalar(1 + jitter(rng, 0.22))
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()

  const body         = new THREE.Mesh(geometry, createStandardMaterial('matte', { color, flatShading: true }))
  body.castShadow    = true
  body.receiveShadow = true

  return finish(new Prop('rock').addPart('body', body), scale)
}

/** Options for {@link treeProp}. */
export interface TreeOptions extends PropOptions {
  trunkColor?:  THREE.ColorRepresentation
  canopyColor?: THREE.ColorRepresentation
}

/**
 * A stylised conifer: tapered trunk plus two stacked canopy cones.
 *
 * @returns A {@link Prop} with parts `trunk`, `canopyLower`, and `canopyUpper`.
 */
export function treeProp ({
  rng,
  scale = 1,
  trunkColor = '#4a3728',
  canopyColor = '#3f7d52',
}: TreeOptions = {}): Prop {
  const height = 1.6 + jitter(rng, 0.35)
  const prop   = new Prop('tree')

  const trunkMaterial  = createStandardMaterial('matte', { color: trunkColor, flatShading: true })
  const canopyMaterial = createStandardMaterial('matte', { color: canopyColor, flatShading: true })

  const trunk      = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, height * 0.5, 6), trunkMaterial)
  trunk.position.y = height * 0.25

  const lower      = new THREE.Mesh(new THREE.ConeGeometry(0.42, height * 0.55, 7), canopyMaterial)
  lower.position.y = height * 0.6

  const upper      = new THREE.Mesh(new THREE.ConeGeometry(0.3, height * 0.45, 7), canopyMaterial)
  upper.position.y = height * 0.95

  for (const mesh of [ trunk, lower, upper ]) {
    mesh.castShadow    = true
    mesh.receiveShadow = true
  }

  return finish(
    prop.addPart('trunk', trunk).addPart('canopyLower', lower)
      .addPart('canopyUpper', upper),
    scale,
  )
}

/** Options for {@link lampPostProp}. */
export interface LampPostOptions extends PropOptions {
  lightColor?: THREE.ColorRepresentation

  /** Attach a real {@link THREE.PointLight} to the bulb. @defaultValue false */
  withLight?: boolean
}

/**
 * A lamp post with an emissive bulb, optionally carrying a real point light.
 *
 * @returns A {@link Prop} with parts `post` and `bulb` (plus `light` when requested).
 * @remarks Lights are not free — prefer the emissive bulb alone for set
 * dressing and enable `withLight` only for the few that must actually cast.
 */
export function lampPostProp ({
  scale = 1,
  lightColor = '#ffd9a0',
  withLight = false,
}: LampPostOptions = {}): Prop {
  const prop = new Prop('lamp-post')

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 2, 8),
    createStandardMaterial('metal', { color: '#2f333b', roughness: 0.6 }),
  )
  post.position.y = 1
  post.castShadow = true

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    createStandardMaterial('emissive', { emissive: lightColor, emissiveIntensity: 3 }),
  )
  bulb.position.y = 2.05

  prop.addPart('post', post).addPart('bulb', bulb)

  if (withLight) {
    const light      = new THREE.PointLight(lightColor, 4, 8, 2)
    light.position.y = 2.05
    prop.addPart('light', light)
  }

  return finish(prop, scale)
}

// perf: one draw call per part. For fields of these, build one and instance it
// rather than calling the factory per placement.
