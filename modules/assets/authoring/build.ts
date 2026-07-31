// modules/assets/authoring/build.ts
// Spec in, Prop out.
//
// The compiler is deliberately dull: no interpretation, no cleverness, no
// hidden defaults beyond the ones the validator already wrote down. Two runs of
// the same spec produce the same triangles, which is what makes a generated
// prop reviewable, diffable, and cacheable.
//
// It shares one material per (surface, colour, glow) triple and one geometry per
// part across all its repeat copies — a 24-post fence is 24 draw calls of ONE
// geometry, not 24 of everything. Prop.dispose dedupes on the way out, so the
// sharing is free of double-free risk.

import * as THREE from 'three'

import { createStandardMaterial } from '../materials.js'
import { Prop } from '../prop.js'

import { FLAT_SHAPES } from './spec.js'
import { buildShape } from './shapes.js'
import { resolvePlacements } from './layout.js'
import { validatePropSpec } from './validate.js'

import type { MaterialPreset } from '../materials.js'
import type { NormalizedPart, NormalizedPropSpec, PropSpec } from './spec.js'
import type { SpecReview } from './validate.js'


/** Options for {@link buildProp}. */
export interface BuildPropOptions {

  /**
   * Skip validation and treat the spec as already normalized. Only safe for a
   * spec that came out of {@link validatePropSpec}.
   * @defaultValue false
   */
  trusted?: boolean
}

function materialKey (part: NormalizedPart, doubleSided: boolean): string {
  return `${part.material}|${part.color}|${part.glow}|${doubleSided ? 'ds' : 'ss'}`
}

function makeMaterial (part: NormalizedPart, doubleSided: boolean): THREE.Material {
  const preset: MaterialPreset                       = part.material
  const params: THREE.MeshPhysicalMaterialParameters = { color: part.color }

  if (doubleSided)
    params.side = THREE.DoubleSide
  if (preset === 'emissive' || part.glow > 0) {
    params.emissive          = part.color
    params.emissiveIntensity = part.glow > 0 ? part.glow : 2.5
  }
  // an emissive surface is the colour it emits, so let the base colour go dark
  if (preset === 'emissive')
    params.color = '#000000'

  return createStandardMaterial(preset, params)
}

/**
 * Compile a prop spec into a {@link Prop}.
 *
 * @param spec - A raw spec, a JSON string, or a normalized spec.
 * @returns A {@link Prop} whose parts are named after the spec's parts (`leg1`,
 * `leg2`, … for repeated ones). It owns everything it built — call `dispose()`.
 * @throws Error when the spec cannot be repaired into something buildable; the
 * message is the validation report.
 * @example
 * const crate = buildProp({
 *   name:  'crate',
 *   parts: [{ shape: 'box', size: [ 0.8, 0.8, 0.8 ], at: [ 0, 0.4, 0 ], color: '#8a6a44' }],
 * })
 * scene.add(crate)
 */
export function buildProp (spec: PropSpec | NormalizedPropSpec | string, options: BuildPropOptions = {}): Prop {
  const resolved = options.trusted && typeof spec !== 'string'
    ? spec as NormalizedPropSpec
    : requireSpec(spec)

  const prop      = new Prop(resolved.name)
  const materials = new Map<string, THREE.Material>()

  for (const [ index, part ] of resolved.parts.entries()) {
    const flat     = FLAT_SHAPES.includes(part.shape)
    const geometry = buildShape(part, resolved.seed + index * 977)
    const key      = materialKey(part, flat)

    let material = materials.get(key)
    if (!material) {
      material = makeMaterial(part, flat)
      materials.set(key, material)
    }

    for (const placement of resolvePlacements(part)) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name  = placement.name
      mesh.position.set(...placement.position)
      mesh.rotation.set(...placement.rotation)
      mesh.castShadow    = part.shadow
      mesh.receiveShadow = part.shadow
      prop.addPart(placement.name, mesh)
    }
  }

  if (resolved.scale !== 1)
    prop.scale.setScalar(resolved.scale)

  return prop
}

function requireSpec (spec: PropSpec | NormalizedPropSpec | string): NormalizedPropSpec {
  const review = validatePropSpec(spec)
  if (!review.spec)
    throw new Error(`buildProp: unusable spec\n${review.report}`)
  return review.spec
}

/** Result of {@link tryBuildProp} — a {@link SpecReview} plus what it built. */
export interface BuildAttempt extends SpecReview {

  /** The compiled prop, or `null` when validation failed. */
  prop: Prop | null
}

/**
 * Validate and build without throwing — the shape an agent loop wants.
 *
 * @returns The review, plus `prop` when it built. On failure `report` is the
 * text to hand back to the model for another attempt.
 * @example
 * const attempt = tryBuildProp(modelOutput)
 * if (attempt.prop) scene.add(attempt.prop)
 * else await retry(attempt.report)
 */
export function tryBuildProp (spec: unknown, options: BuildPropOptions = {}): BuildAttempt {
  const review = validatePropSpec(spec)
  if (!review.spec)
    return { ...review, prop: null }

  return { ...review, prop: buildProp(review.spec, { ...options, trusted: true }) }
}

// perf: one geometry + one mesh per placement, one material per distinct
// surface. Repeat copies share geometry, so a repeated part costs draw calls,
// not memory.
