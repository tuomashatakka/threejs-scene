// modules/authoring/prompt.ts
// What you actually send to the model.
//
// A small model does not need the schema explained; it needs the three facts it
// gets wrong (sizes are the box the shape fills, `at` is the CENTRE, `size` is
// measured before `rotate`), a list of the words it may use, and two worked
// examples to imitate. Everything else is tokens it will not read.
//
// The examples are exported as data, not prose, so the test suite compiles them
// and checks the critic has nothing to say about them. A worked example that
// silently rots into a floating chair is worse than none.

import { SHAPE_NAMES, SPEC_LIMITS, SURFACE_NAMES } from './spec.js'

import type { PropSpec } from './spec.js'


/** A worked example: what was asked for, and the spec that answers it. */
export interface PropExample {

  /** The request, phrased the way a user would. */
  brief: string

  /** A spec that satisfies it — and passes the critic. */
  spec: PropSpec
}

/**
 * The dialect, in one page. Written for a model with a short attention span:
 * rules first, vocabulary second, no theory.
 */
export const PROP_SPEC_GRAMMAR = `You build 3D props by emitting JSON. No code, no prose — JSON only.

{ "name": "wooden chair", "parts": [ { "shape": "box", "size": [1,1,1], "at": [0,0.5,0] } ] }

Rules
- Units are metres. y is up. The ground is y = 0. Centre the prop on x = 0, z = 0.
- "size" is the box the shape FILLS: [x, y, z]. A sphere with size [1,2,1] is an egg.
- "at" is the CENTRE of the part. A part h tall rests on the ground at y = h/2.
- Better than guessing a height: "on": "<name of an earlier part>" stacks this part on top of it.
- "size" is measured before "rotate". Rotating a [0.1, 1, 0.1] post by 90 degrees lays it down.
- "rotate" is in DEGREES: [x, y, z].
- Parts must touch or overlap each other — a prop is one connected object.
- Build the big parts first, then the details. At most ${SPEC_LIMITS.maxParts} parts.
- Repeat instead of copying: legs, posts, spokes, and railings are one part with "repeat".

Fields per part
  shape     ${SHAPE_NAMES.join(' | ')}
  size      [x, y, z] in metres
  at        [x, y, z] centre, in metres
  on        name of an earlier part to stand on  (optional)
  rotate    [x, y, z] in degrees            (optional)
  color     hex, e.g. "#8a4436"             (optional)
  material  ${SURFACE_NAMES.join(' | ')}
  glow      0 = none, 2-4 = lamp or gem     (optional)
  detail    0 facetted, 1 normal, 3 smooth  (optional)
  repeat    { "count": n, "mode": "linear" | "radial" | "mirror", … }   (optional)

Shape notes
- plane, disc and ring are flat and lie on the ground; their y size is ignored.
- cylinder takes "taper" (top radius over bottom, 1 = straight, 0 = a point).
- prism and cylinder take "sides"; torus, knot and ring take "thickness".
- rock and crystal are lumpy and facetted — use them for stone and gems.
- wedge is a ramp rising toward +z; rotate it by 180 for a roof.

Repeat modes
- linear: "offset" [x,y,z] steps between copies.        fence posts, stairs, slats
- radial: "radius", "arc" degrees, "axis", "faceOut".   spokes, petals, a ring of logs
- mirror: "axis" x or z; count 2 mirrors once, count 4 mirrors both ways. legs, wheels, wings`

/** Worked examples, in the order they are usually shown. */
export const PROP_EXAMPLES: readonly PropExample[] = [
  {
    brief: 'a wooden chair',
    spec:  {
      name:  'wooden chair',
      parts: [
        { name: 'seat', shape: 'box', size: [ 0.45, 0.06, 0.45 ], at: [ 0, 0.45, 0 ], color: '#8a6a44' },
        { name: 'back', shape: 'box', size: [ 0.45, 0.5, 0.05 ], at: [ 0, 0.72, -0.2 ], color: '#8a6a44' },
        {
          name:   'leg',
          shape:  'box',
          size:   [ 0.05, 0.45, 0.05 ],
          at:     [ 0.18, 0.225, 0.18 ],
          color:  '#7a5c3c',
          repeat: { count: 4, mode: 'mirror', axis: 'x' },
        },
      ],
    },
  },
  {
    brief: 'a small round table, using "on" instead of guessing heights',
    spec:  {
      name:  'round table',
      parts: [
        { name: 'base', shape: 'cylinder', size: [ 0.4, 0.05, 0.4 ], at: [ 0, 0.025, 0 ], color: '#4a3728' },
        { name: 'stem', shape: 'cylinder', size: [ 0.09, 0.68, 0.09 ], at: [ 0, 0, 0 ], on: 'base', color: '#4a3728' },
        { name: 'top', shape: 'cylinder', size: [ 0.8, 0.05, 0.8 ], at: [ 0, 0, 0 ], on: 'stem', color: '#8a6a44' },
      ],
    },
  },
  {
    brief: 'a street lamp that glows',
    spec:  {
      name:  'street lamp',
      parts: [
        { name: 'post', shape: 'cylinder', size: [ 0.1, 2.6, 0.1 ], at: [ 0, 1.3, 0 ], color: '#2f333b', material: 'metal' },
        { name: 'hood', shape: 'cone', size: [ 0.4, 0.22, 0.4 ], at: [ 0, 2.62, 0 ], rotate: [ 180, 0, 0 ], color: '#2f333b', material: 'metal' },
        { name: 'bulb', shape: 'sphere', size: [ 0.18, 0.18, 0.18 ], at: [ 0, 2.46, 0 ], color: '#ffd9a0', material: 'emissive', glow: 3 },
      ],
    },
  },
  {
    brief: 'a banded wooden crate',
    spec:  {
      name:  'crate',
      parts: [
        { name: 'body', shape: 'box', size: [ 0.8, 0.8, 0.8 ], at: [ 0, 0.4, 0 ], color: '#8a6a44' },
        {
          name:   'band',
          shape:  'box',
          size:   [ 0.84, 0.07, 0.84 ],
          at:     [ 0, 0.08, 0 ],
          color:  '#4a3728',
          repeat: { count: 2, mode: 'linear', offset: [ 0, 0.64, 0 ]},
        },
      ],
    },
  },
  {
    brief: 'a campfire',
    spec:  {
      name:  'campfire',
      parts: [
        {
          name:   'log',
          shape:  'cylinder',
          size:   [ 0.1, 0.6, 0.1 ],
          at:     [ 0, 0.14, 0 ],
          rotate: [ 65, 0, 0 ],
          color:  '#5a4632',
          repeat: { count: 5, mode: 'radial', radius: 0.16, arc: 360, axis: 'y' },
        },
        { name: 'embers', shape: 'rock', size: [ 0.3, 0.16, 0.3 ], at: [ 0, 0.08, 0 ], color: '#ff7a2f', material: 'emissive', glow: 4 },
      ],
    },
  },
  {
    brief: 'a toadstool',
    spec:  {
      name:  'toadstool',
      parts: [
        { name: 'stem', shape: 'cylinder', size: [ 0.16, 0.5, 0.16 ], at: [ 0, 0.25, 0 ], taper: 0.8, color: '#efe6d5' },
        { name: 'cap', shape: 'sphere', size: [ 0.62, 0.42, 0.62 ], at: [ 0, 0.54, 0 ], color: '#b8412f' },
        {
          name:   'spot',
          shape:  'sphere',
          size:   [ 0.09, 0.06, 0.09 ],
          at:     [ 0, 0.7, 0 ],
          color:  '#f6f1e6',
          repeat: { count: 6, mode: 'radial', radius: 0.2, arc: 360, axis: 'y', faceOut: false },
        },
      ],
    },
  },
]

/** Options for {@link propAuthoringPrompt}. */
export interface PromptOptions {

  /** How many worked examples to include. @defaultValue 2 */
  examples?: number

  /** Drop the shape notes and repeat modes for a very small context. @defaultValue false */
  compact?: boolean
}

/**
 * Assemble the system prompt for a prop-authoring model.
 *
 * @returns Grammar, vocabulary, and worked examples as one string.
 * @remarks Pair it with {@link PROP_SPEC_SCHEMA} when the provider supports
 * structured output — the schema pins the shape, the prompt teaches the
 * conventions (metres, centres, connectedness) that a schema cannot express.
 * @example
 * const system = propAuthoringPrompt({ examples: 3 })
 */
export function propAuthoringPrompt ({ examples = 2, compact = false }: PromptOptions = {}): string {
  const grammar = compact
    ? PROP_SPEC_GRAMMAR.slice(0, PROP_SPEC_GRAMMAR.indexOf('\nShape notes'))
    : PROP_SPEC_GRAMMAR

  const worked = PROP_EXAMPLES.slice(0, Math.max(0, examples))
    .map(example => `# ${example.brief}\n${JSON.stringify(example.spec)}`)
    .join('\n\n')

  return worked ? `${grammar}\n\nExamples\n\n${worked}` : grammar
}

/**
 * The follow-up turn: what to send after a spec came back broken or ugly.
 *
 * @param report - The `report` from {@link tryBuildProp} or {@link reviewProp}.
 * @returns A short correction turn. Keeping it short matters — a small model
 * re-reading its own mistake at length tends to repeat it.
 * @example
 * const attempt = tryBuildProp(text)
 * if (!attempt.ok) await complete(propRetryPrompt(attempt.report))
 */
export function propRetryPrompt (report: string): string {
  return `Your prop has problems:\n\n${report}\n\nFix only these and return the whole corrected JSON. JSON only.`
}
