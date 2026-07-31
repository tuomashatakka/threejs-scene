// modules/assets/authoring/spec.ts
// The prop spec: a tiny JSON dialect a small language model can emit reliably.
//
// Every design choice here trades expressiveness for hit rate. A 3B model does
// not keep `new THREE.CylinderGeometry(radiusTop, radiusBottom, height,
// radialSegments, …)` straight, but it does know that a chair leg is a thin box
// 0.4m tall standing at the corner. So the dialect is:
//
//   - one vocabulary of shape WORDS, no constructor signatures;
//   - every shape sized by the box it fills — `size: [x, y, z]` in metres,
//     identical for a sphere, a torus and a wedge;
//   - `at` in metres with y up and the ground at y = 0, `rotate` in DEGREES;
//   - repetition declared, not unrolled, so four table legs cost one part.
//
// Nothing here touches three.js: a spec is plain JSON that survives a tool call,
// a log line, and a round trip through a model that only speaks text.

import type { MaterialPreset } from '../materials.js'


/** A 3-component tuple in the spec: `[x, y, z]`. */
export type SpecVec3 = readonly [number, number, number]

/**
 * The shape vocabulary. Deliberately small and made of everyday words — the
 * model picks a noun, not a geometry class.
 *
 * `plane`, `disc`, and `ring` are flat and lie in the ground plane (their `y`
 * size is ignored); everything else is a solid that fills its `size` box.
 */
export const SHAPE_NAMES = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'prism',
  'capsule',
  'torus',
  'knot',
  'crystal',
  'rock',
  'wedge',
  'plane',
  'disc',
  'ring',
] as const

/** Name of a shape in {@link SHAPE_NAMES}. */
export type ShapeName = (typeof SHAPE_NAMES)[number]

/** Shapes with no thickness: they lie flat in the ground plane. */
export const FLAT_SHAPES: readonly ShapeName[] = [ 'plane', 'disc', 'ring' ]

/** Surface names accepted by a part — the {@link MaterialPreset} vocabulary. */
export const SURFACE_NAMES = [
  'matte',
  'metal',
  'chrome',
  'gold',
  'plastic',
  'rubber',
  'glass',
  'emissive',
] as const satisfies readonly MaterialPreset[]

/** How copies of a part are laid out. */
export type RepeatMode = 'linear' | 'radial' | 'mirror'

/** An axis name, used by `repeat`. */
export type AxisName = 'x' | 'y' | 'z'

/**
 * Repetition of a single part. Declaring it beats unrolling it: the model
 * writes one leg and a count instead of four near-identical blocks it has to
 * keep consistent, and the compiler shares one geometry across every copy.
 */
export interface RepeatSpec {

  /** How many copies in total, including the original. */
  count?: number

  /**
   * `linear` steps by `offset`, `radial` rings around `axis` at `radius`,
   * `mirror` reflects across the part's own position.
   * @defaultValue `'linear'`
   */
  mode?: RepeatMode

  /** `linear` only: the step between copies, in metres. */
  offset?: SpecVec3 | number

  /** `radial` only: distance from `at` to each copy, in metres. @defaultValue 1 */
  radius?: number

  /** `radial` only: the spread in degrees. @defaultValue 360 */
  arc?: number

  /** Ring axis (`radial`) or mirror plane normal (`mirror`). @defaultValue `'y'` for radial, `'x'` for mirror */
  axis?: AxisName

  /** `radial` only: turn each copy to face away from the centre. @defaultValue true */
  faceOut?: boolean
}

/**
 * One part of a prop: a shape, a place to put it, and how it looks.
 *
 * `shape` is the only required field — a bare `{ "shape": "box" }` is a valid
 * 1m cube, so a model that forgets everything else still produces something.
 */
export interface PartSpec {

  /** Label for the part, e.g. `"leg"`. Becomes the {@link Prop} part name. */
  name?: string

  /** What to build. See {@link SHAPE_NAMES}. */
  shape: ShapeName | string

  /**
   * Size of the box the shape fills, in metres. A single number means a cube
   * of that size. @defaultValue 1
   */
  size?: SpecVec3 | number

  /** Centre of the part, in metres, y up, ground at 0. @defaultValue `[0, 0, 0]` */
  at?: SpecVec3 | number

  /**
   * Rest this part on top of an earlier part, by name. The compiler works out
   * the height; `at` still sets x and z. Use it instead of guessing a y.
   */
  on?: string

  /** Rotation in DEGREES around x, y, z. @defaultValue `[0, 0, 0]` */
  rotate?: SpecVec3 | number

  /** CSS hex or colour name, e.g. `"#8a4436"` or `"tomato"`. @defaultValue `'#b9b6ae'` */
  color?: string

  /** Surface finish. See {@link SURFACE_NAMES}. @defaultValue `'matte'` */
  material?: MaterialPreset | string

  /** Emissive gain; above 0 the part glows and blooms. @defaultValue 0 */
  glow?: number

  /** Roundness/subdivision, 0 (facetted) to 3 (smooth). @defaultValue 1 */
  detail?: number

  /** `prism`, `cylinder`, `cone`: number of sides around. @defaultValue 6 for prism, 16 otherwise */
  sides?: number

  /** `cylinder`: top radius as a fraction of the bottom. 0 makes a cone. @defaultValue 1 */
  taper?: number

  /** `torus`, `knot`, `ring`: tube thickness as a fraction of the radius. @defaultValue 0.3 */
  thickness?: number

  /** Repeat this part. @defaultValue none */
  repeat?: RepeatSpec

  /** Cast and receive shadows. @defaultValue true */
  shadow?: boolean
}

/** A whole prop: a name and its parts. */
export interface PropSpec {

  /** What the thing is, e.g. `"wooden chair"`. @defaultValue `'prop'` */
  name?: string

  /** The parts, in build order. At least one. */
  parts: PartSpec[]

  /** Uniform scale applied to the finished prop. @defaultValue 1 */
  scale?: number

  /** Seed for the shapes that vary (`rock`). Same seed → same prop. @defaultValue 1 */
  seed?: number

  /** Free-form notes from the author. Ignored by the compiler. */
  notes?: string
}

/** A {@link PartSpec} with every field resolved, clamped, and defaulted. */
export interface NormalizedPart {
  name:  string
  shape: ShapeName
  size:  SpecVec3
  at:    SpecVec3

  /** Name of the part this one rests on, or `null`. Already resolved into `at`. */
  on:        string | null
  rotate:    SpecVec3
  color:     string
  material:  MaterialPreset
  glow:      number
  detail:    number
  sides:     number
  taper:     number
  thickness: number
  shadow:    boolean
  repeat:    NormalizedRepeat | null
}

/** A {@link RepeatSpec} with every field resolved. */
export interface NormalizedRepeat {
  count:   number
  mode:    RepeatMode
  offset:  SpecVec3
  radius:  number
  arc:     number
  axis:    AxisName
  faceOut: boolean
}

/** A {@link PropSpec} with every field resolved — what {@link buildProp} consumes. */
export interface NormalizedPropSpec {
  name:   string
  scale:  number
  seed:   number
  parts:  NormalizedPart[]
  notes?: string
}

/**
 * Budgets the validator enforces. They are generous for a prop and tight enough
 * that a runaway generation cannot allocate a million triangles: a model that
 * asks for 5000 fence posts gets clamped and told so, rather than hanging the
 * page.
 */
export const SPEC_LIMITS = {

  /** Parts per prop, before repetition. */
  maxParts: 32,

  /** Copies a single `repeat` may produce. */
  maxCopies: 64,

  /** Meshes in the finished prop, across every part. */
  maxMeshes: 256,

  /** Metres. A prop is furniture-to-building sized, not a landscape. */
  maxSize: 50,

  /** Metres. Below this a part is invisible; sizes are clamped up to it. */
  minSize: 0.001,

  /** Metres from the origin. */
  maxOffset: 100,
} as const

/** Defaults applied to every part the model leaves unspecified. */
export const PART_DEFAULTS = {
  size:      1,
  color:     '#b9b6ae',
  material:  'matte' as MaterialPreset,
  glow:      0,
  detail:    1,
  taper:     1,
  thickness: 0.3,
  shadow:    true,
} as const
