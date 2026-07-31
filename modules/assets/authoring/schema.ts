// modules/assets/authoring/schema.ts
// The spec as JSON Schema, for structured output and function calling.
//
// It is generated from the same constants the compiler uses, so the enum a
// model is constrained to can never drift from the vocabulary the builder
// accepts. Descriptions are one short line each: with a constrained decoder the
// schema IS the prompt, and every token of it is paid for on every call.

import { SHAPE_NAMES, SPEC_LIMITS, SURFACE_NAMES } from './spec.js'


/** A JSON Schema fragment. Structural only — enough to type the export. */
export interface JsonSchema {
  type?:                 string | string[]
  description?:          string
  enum?:                 readonly string[]
  items?:                JsonSchema
  properties?:           Record<string, JsonSchema>
  required?:             readonly string[]
  additionalProperties?: boolean
  minItems?:             number
  maxItems?:             number
  minimum?:              number
  maximum?:              number
  default?:              unknown
  oneOf?:                readonly JsonSchema[]
}

const vec3: JsonSchema = {
  type:     'array',
  items:    { type: 'number' },
  minItems: 3,
  maxItems: 3,
}

const repeatSchema: JsonSchema = {
  type:        'object',
  description: 'Repeat this part instead of writing it out again.',
  properties:  {
    count:   { type: 'integer', description: `Copies in total, including the original. Max ${SPEC_LIMITS.maxCopies}.`, minimum: 1, maximum: SPEC_LIMITS.maxCopies },
    mode:    { type: 'string', enum: [ 'linear', 'radial', 'mirror' ], description: 'linear: step by offset. radial: ring around axis. mirror: 2 copies across axis, or 4 for the corners of a table.' },
    offset:  { ...vec3, description: 'linear only: step between copies, in metres.' },
    radius:  { type: 'number', description: 'radial only: distance from "at" to each copy, in metres.' },
    arc:     { type: 'number', description: 'radial only: spread in degrees. 360 makes a full ring.' },
    axis:    { type: 'string', enum: [ 'x', 'y', 'z' ], description: 'Ring axis (radial) or mirror plane (mirror).' },
    faceOut: { type: 'boolean', description: 'radial only: turn each copy to face away from the centre.' },
  },
  required:             [ 'count', 'mode' ],
  additionalProperties: false,
}

const partSchema: JsonSchema = {
  type:       'object',
  properties: {
    name:      { type: 'string', description: 'What this part is, e.g. "leg", "roof".' },
    shape:     { type: 'string', enum: SHAPE_NAMES, description: 'Which shape to build. plane, disc and ring are flat and lie on the ground.' },
    size:      { ...vec3, description: 'Size of the box the shape fills: [x, y, z] in metres.' },
    at:        { ...vec3, description: 'Centre of the part in metres: [x, y, z], y up, ground at 0. A part of height h rests on the ground at y = h/2.' },
    on:        { type: 'string', description: 'Name of an EARLIER part to rest on top of. The height is worked out for you; "at" still sets x and z. Prefer this over guessing a y.' },
    rotate:    { ...vec3, description: 'Rotation in DEGREES around [x, y, z].' },
    color:     { type: 'string', description: 'Hex colour, e.g. "#8a4436".' },
    material:  { type: 'string', enum: SURFACE_NAMES, description: 'Surface finish.' },
    glow:      { type: 'number', description: 'Above 0 the part glows. Use 2-4 for lamps and gems.', minimum: 0, maximum: 20 },
    detail:    { type: 'integer', description: '0 facetted and cheap, 1 default, 3 smooth.', minimum: 0, maximum: 3 },
    sides:     { type: 'integer', description: 'prism/cylinder/cone: number of sides around.', minimum: 3, maximum: 64 },
    taper:     { type: 'number', description: 'cylinder: top radius as a fraction of the bottom. 1 straight, 0 a point.', minimum: 0, maximum: 8 },
    thickness: { type: 'number', description: 'torus/knot/ring: tube thickness as a fraction of the radius.', minimum: 0.02, maximum: 0.98 },
    repeat:    repeatSchema,
  },
  required:             [ 'shape', 'size', 'at' ],
  additionalProperties: false,
}

/**
 * JSON Schema for a whole prop spec.
 *
 * Drop it straight into a tool definition — Anthropic `input_schema`, OpenAI
 * `parameters`, Gemini `functionDeclarations[].parameters`, or an ai-sdk
 * `jsonSchema()` — or use it to constrain a local model's decoder.
 *
 * @example
 * { name: 'create_prop', input_schema: PROP_SPEC_SCHEMA }
 */
export const PROP_SPEC_SCHEMA: JsonSchema = {
  type:        'object',
  description: 'A small 3D prop, built from simple shapes. Units are metres, y is up, the ground is y = 0, and the prop is centred on x = 0, z = 0.',
  properties:  {
    name:  { type: 'string', description: 'What the prop is, e.g. "wooden chair".' },
    parts: {
      type:        'array',
      description: `The parts, largest first. At most ${SPEC_LIMITS.maxParts}.`,
      items:       partSchema,
      minItems:    1,
      maxItems:    SPEC_LIMITS.maxParts,
    },
    scale: { type: 'number', description: 'Uniform scale applied to the finished prop.' },
    seed:  { type: 'integer', description: 'Seed for the shapes that vary (rock).' },
  },
  required:             [ 'name', 'parts' ],
  additionalProperties: false,
}
