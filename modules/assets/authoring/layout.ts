// modules/assets/authoring/layout.ts
// Repetition, expanded.
//
// `repeat` exists because the failure mode of a small model is not inventing a
// chair — it is writing the fourth leg with a typo in the third coordinate.
// Declaring "one leg, mirrored twice" removes the arithmetic from the model and
// gives it to the compiler.
//
// Both the builder and the reviewer walk THIS list, so what the reviewer
// measures is exactly what the builder places — a critique can never describe a
// prop that was not built.

import * as THREE from 'three'

import type { NormalizedPart, SpecVec3 } from './spec.js'


/** One placed copy of a part: where it goes and what it is called. */
export interface Placement {

  /** Unique part name — `leg` alone, or `leg1`, `leg2`, … when repeated. */
  name: string

  /** Centre of the copy, in prop-local metres. */
  position: SpecVec3

  /** Rotation in RADIANS (spec degrees, converted). */
  rotation: SpecVec3
}

const DEG = Math.PI / 180

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

function toRadians (degrees: SpecVec3): SpecVec3 {
  return [ degrees[0] * DEG, degrees[1] * DEG, degrees[2] * DEG ]
}

function copyName (base: string, index: number, total: number): string {
  return total > 1 ? `${base}${index + 1}` : base
}

/**
 * Expand a part into every copy it places.
 *
 * @returns One {@link Placement} per copy, in build order. A part with no
 * `repeat` yields exactly one.
 * @remarks Mirroring flips the rotations that would otherwise break the
 * symmetry: reflecting a leg that leans outward across `x` must also negate its
 * `y` and `z` tilt, or the mirrored leg leans the wrong way.
 */
export function resolvePlacements (part: NormalizedPart): Placement[] {
  const rotation = toRadians(part.rotate)
  const repeat   = part.repeat

  if (!repeat || repeat.count <= 1)
    return [{ name: part.name, position: part.at, rotation }]

  if (repeat.mode === 'linear')
    return linear(part, rotation)
  if (repeat.mode === 'radial')
    return radial(part, rotation)
  return mirror(part, rotation)
}

function linear (part: NormalizedPart, rotation: SpecVec3): Placement[] {
  const { count, offset }       = part.repeat as NonNullable<NormalizedPart['repeat']>
  const placements: Placement[] = []

  for (let i = 0; i < count; i++)
    placements.push({
      name:     copyName(part.name, i, count),
      position: [ part.at[0] + offset[0] * i, part.at[1] + offset[1] * i, part.at[2] + offset[2] * i ],
      rotation,
    })
  return placements
}

function radial (part: NormalizedPart, rotation: SpecVec3): Placement[] {
  const repeat                                = part.repeat as NonNullable<NormalizedPart['repeat']>
  const { count, radius, arc, axis, faceOut } = repeat

  // a full turn puts the last copy back on the first, so close the ring by
  // stepping count times; a partial arc spans end to end.
  const full  = Math.abs(arc % 360) < 1e-6 && arc !== 0
  const step  = arc * DEG / (full ? count : Math.max(1, count - 1))
  const spin  = new THREE.Quaternion()
  const base  = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
  const unit  = new THREE.Vector3()
  const euler = new THREE.Euler()

  const axisVector = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
  // the ring lies in the plane perpendicular to `axis`
  const spoke = axis === 'y' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)

  const placements: Placement[] = []
  for (let i = 0; i < count; i++) {
    const angle = step * i
    spin.setFromAxisAngle(axisVector, angle)
    unit.copy(spoke).applyQuaternion(spin)
      .multiplyScalar(radius)

    const orientation = faceOut ? spin.clone().multiply(base) : base
    euler.setFromQuaternion(orientation)

    placements.push({
      name:     copyName(part.name, i, count),
      position: [ part.at[0] + unit.x, part.at[1] + unit.y, part.at[2] + unit.z ],
      rotation: [ euler.x, euler.y, euler.z ],
    })
  }
  return placements
}

function mirror (part: NormalizedPart, rotation: SpecVec3): Placement[] {
  const repeat = part.repeat as NonNullable<NormalizedPart['repeat']>
  // 2 copies reflect across one plane; 4 reflect across that plane and the
  // other horizontal one — the four-legs-of-a-table case, in one part.
  const planes: ('x' | 'y' | 'z')[] = repeat.count >= 4
    ? [ repeat.axis, repeat.axis === 'z' ? 'x' : 'z' ]
    : [ repeat.axis ]

  let placements: Placement[] = [{ name: part.name, position: part.at, rotation }]

  for (const plane of planes) {
    const index = AXIS_INDEX[plane]
    placements = placements.flatMap(placement => [
      placement,
      {
        name:     placement.name,
        position: reflectVector(placement.position, index),
        rotation: reflectRotation(placement.rotation, index),
      },
    ])
  }

  return placements.map((placement, index) => ({ ...placement, name: copyName(part.name, index, placements.length) }))
}

function reflectVector (vector: SpecVec3, index: number): SpecVec3 {
  const mirrored: [number, number, number] = [ vector[0], vector[1], vector[2] ]
  mirrored[index]                          = -(mirrored[index] ?? 0)
  return mirrored
}

// Reflecting a pose across an axis negates the rotation about the OTHER two
// axes: a leg tilted outward stays tilted outward on the far side.
function reflectRotation (rotation: SpecVec3, index: number): SpecVec3 {
  const flipped: [number, number, number] = [ -rotation[0], -rotation[1], -rotation[2] ]
  flipped[index]                          = rotation[index] ?? 0
  return flipped
}

// perf: pure arithmetic at author time; nothing here runs per frame.
