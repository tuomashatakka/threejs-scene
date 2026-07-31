// modules/assets/authoring/validate.ts
// The forgiving front door.
//
// A 70B model emits the schema. A 3B model emits something SHAPED like the
// schema: `"position"` instead of `"at"`, `"cube"` instead of `"box"`, `"0.4"`
// instead of `0.4`, a trailing comma, a sentence before the JSON. Rejecting all
// of that wastes a whole generation on a rename, so the validator repairs what
// is unambiguous, records every repair as a warning the model can learn from,
// and only errors when it genuinely cannot tell what was meant.
//
// The output is two things at once: a normalized spec the compiler can trust,
// and a short human-readable report that is meant to be fed straight back to
// the model as the tool result.

import * as THREE from 'three'

import { FLAT_SHAPES, PART_DEFAULTS, SHAPE_NAMES, SPEC_LIMITS, SURFACE_NAMES } from './spec.js'
import { resolveRelations } from './relations.js'

import type { MaterialPreset } from '../materials.js'
import type {
  AxisName,
  NormalizedPart,
  NormalizedPropSpec,
  NormalizedRepeat,
  RepeatMode,
  ShapeName,
  SpecVec3,
} from './spec.js'


/** Severity of a {@link SpecIssue}. */
export type IssueLevel = 'error' | 'warning' | 'note'

/** One thing worth telling the author about, addressed to a field. */
export interface SpecIssue {

  /** `error` blocks the build; `warning` records a repair; `note` is advice. */
  level: IssueLevel

  /** Dotted path into the spec, e.g. `parts[2].size`. */
  path: string

  /** What is wrong, in one line. */
  message: string
}

/** Result of {@link validatePropSpec}. */
export interface SpecReview {

  /** True when the spec built cleanly enough to compile. */
  ok: boolean

  /** The resolved spec — `null` only when `ok` is false. */
  spec: NormalizedPropSpec | null

  /** Errors, repairs, and advice, in discovery order. */
  issues: SpecIssue[]

  /** The issues rendered as short text, ready to hand back to a model. */
  report: string
}

const SHAPE_SYNONYMS: Record<string, ShapeName> = {
  cube:       'box',
  block:      'box',
  cuboid:     'box',
  slab:       'box',
  plank:      'box',
  panel:      'box',
  ball:       'sphere',
  orb:        'sphere',
  globe:      'sphere',
  dome:       'sphere',
  tube:       'cylinder',
  pipe:       'cylinder',
  rod:        'cylinder',
  stick:      'cylinder',
  pole:       'cylinder',
  column:     'cylinder',
  barrel:     'cylinder',
  spike:      'cone',
  horn:       'cone',
  hexagon:    'prism',
  hex:        'prism',
  octagon:    'prism',
  polygon:    'prism',
  pill:       'capsule',
  donut:      'torus',
  doughnut:   'torus',
  wheel:      'torus',
  tyre:       'torus',
  tire:       'torus',
  gem:        'crystal',
  diamond:    'crystal',
  jewel:      'crystal',
  octahedron: 'crystal',
  stone:      'rock',
  boulder:    'rock',
  ramp:       'wedge',
  roof:       'wedge',
  slope:      'wedge',
  quad:       'plane',
  floor:      'plane',
  ground:     'plane',
  circle:     'disc',
  disk:       'disc',
  cap:        'disc',
  annulus:    'ring',
  hoop:       'ring',
}

const SURFACE_SYNONYMS: Record<string, MaterialPreset> = {
  wood:        'matte',
  wooden:      'matte',
  stone:       'matte',
  concrete:    'matte',
  brick:       'matte',
  cloth:       'matte',
  fabric:      'matte',
  paper:       'matte',
  dirt:        'matte',
  leaf:        'matte',
  paint:       'matte',
  painted:     'matte',
  none:        'matte',
  default:     'matte',
  standard:    'matte',
  steel:       'metal',
  iron:        'metal',
  silver:      'metal',
  aluminium:   'metal',
  aluminum:    'metal',
  copper:      'gold',
  brass:       'gold',
  bronze:      'gold',
  mirror:      'chrome',
  shiny:       'chrome',
  polished:    'chrome',
  glossy:      'plastic',
  vinyl:       'plastic',
  tyre:        'rubber',
  tire:        'rubber',
  water:       'glass',
  ice:         'glass',
  crystal:     'glass',
  transparent: 'glass',
  clear:       'glass',
  glowing:     'emissive',
  glow:        'emissive',
  light:       'emissive',
  lamp:        'emissive',
  neon:        'emissive',
  led:         'emissive',
}

// keys a model reaches for when it half-remembers the dialect
const PART_KEY_ALIASES: Record<string, string> = {
  type:       'shape',
  geometry:   'shape',
  primitive:  'shape',
  kind:       'shape',
  form:       'shape',
  position:   'at',
  pos:        'at',
  location:   'at',
  translate:  'at',
  offset:     'at',
  rotation:   'rotate',
  rot:        'rotate',
  euler:      'rotate',
  dimensions: 'size',
  dims:       'size',
  scale:      'size',
  extents:    'size',
  colour:     'color',
  tint:       'color',
  surface:    'material',
  finish:     'material',
  texture:    'material',
  segments:   'detail',
  smoothness: 'detail',
  emissive:   'glow',
  array:      'repeat',
  instances:  'repeat',
  ontopof:    'on',
  restson:    'on',
  stackedon:  'on',
  above:      'on',
}

const HEX_COLOR    = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const CSS_FUNCTION = /^(?:rgb|hsl)a?\(/i

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Levenshtein distance, capped — only used to guess at typos. */
function distance (a: string, b: string): number {
  const rows: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = rows[0] as number
    rows[0]      = i
    for (let j = 1; j <= b.length; j++) {
      const current = rows[j] as number
      rows[j]       = Math.min(
        current + 1,
        (rows[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return rows[b.length] as number
}

function nearest<T extends string> (value: string, candidates: readonly T[]): T | null {
  let best  = null as T | null
  let score = Infinity
  for (const candidate of candidates) {
    const d = distance(value, candidate)
    if (d < score) {
      score = d
      best  = candidate
    }
  }
  return score <= Math.max(1, Math.floor(value.length / 3)) ? best : null
}

/**
 * Pull the first JSON object out of arbitrary model output.
 *
 * @returns The parsed value, or `null` when nothing parseable is present.
 * @remarks Handles the three things small models actually do: wrap the JSON in
 * a ``` fence, chat around it ("Sure! Here is the chair:"), and leave a trailing
 * comma before a closing brace.
 * @example
 * extractJson('Here you go:\n```json\n{ "parts": [] }\n```')
 */
export function extractJson (text: string): unknown {
  const fenced = (/```(?:json)?\s*([\s\S]*?)```/i).exec(text)
  const body   = fenced?.[1] ?? text
  const start  = body.search(/[[{]/)
  if (start < 0)
    return null

  const opener = body[start]
  const closer = opener === '[' ? ']' : '}'
  const end    = body.lastIndexOf(closer)
  if (end < start)
    return null

  const candidate = body.slice(start, end + 1)
  for (const attempt of [ candidate, candidate.replace(/,\s*([}\]])/g, '$1') ])
    try {
      return JSON.parse(attempt)
    }
    catch {
      // fall through to the repaired attempt, then give up
    }
  return null
}

/**
 * Validate and normalize anything that claims to be a prop spec.
 *
 * Accepts a spec object, a JSON string, or a whole model turn with the JSON
 * somewhere inside it. Repairs what it can (renamed keys, synonym shapes,
 * numbers as strings, out-of-range values) and reports each repair as a
 * warning; errors only when a field is unusable.
 *
 * @returns A {@link SpecReview}. When `ok`, `spec` is safe to hand to
 * {@link buildProp}.
 * @example
 * const review = validatePropSpec('{ "name": "crate", "parts": [{ "shape": "cube" }] }')
 * review.ok        // true
 * review.issues[0] // warning parts[0].shape: "cube" is not a shape; used "box"
 */
export function validatePropSpec (input: unknown): SpecReview {
  const issues: SpecIssue[] = []
  const add                 = (level: IssueLevel, path: string, message: string): void => {
    issues.push({ level, path, message })
  }

  const root = unwrap(typeof input === 'string' ? extractJson(input) : input)

  if (!isRecord(root)) {
    add('error', 'spec', 'expected a JSON object like { "name": …, "parts": [ … ] }')
    return finish(null, issues, 'prop')
  }

  const name = readName(root.name, 'prop')
  const raw  = readParts(root.parts, add)

  const parts: NormalizedPart[] = []
  const taken                   = new Set<string>()

  for (const [ index, entry ] of raw.entries()) {
    if (parts.length >= SPEC_LIMITS.maxParts) {
      add('warning', `parts[${index}]`, `only the first ${SPEC_LIMITS.maxParts} parts are kept`)
      break
    }

    const part = readPart(entry, index, taken, add)
    if (part)
      parts.push(part)
  }

  if (parts.length === 0) {
    // don't say it twice: `parts` may already have failed to parse at all
    if (!issues.some(issue => issue.level === 'error'))
      add('error', 'parts', 'a prop needs at least one part, e.g. [{ "shape": "box", "size": 1 }]')
    return finish(null, issues, name)
  }

  // the model states the relation, the solver computes the height — the one
  // thing every study of LLM 3D authoring agrees on
  resolveRelations(parts, (path, message) => add('error', path, message))

  const spec: NormalizedPropSpec = {
    name,
    parts,
    scale: clamp(number(root.scale) ?? 1, 0.001, 1000),
    seed:  Math.floor(number(root.seed) ?? 1),
  }
  const notes = typeof root.notes === 'string' ? root.notes.slice(0, 400) : null
  if (notes)
    spec.notes = notes

  const meshes = parts.reduce((total, part) => total + (part.repeat?.count ?? 1), 0)
  if (meshes > SPEC_LIMITS.maxMeshes)
    add('note', 'parts', `${meshes} meshes is over the ${SPEC_LIMITS.maxMeshes} budget for one prop — merge or instance repeated parts`)

  return finish(spec, issues, name)
}

/**
 * Render issues the way a model reads best: one short line each, errors first.
 *
 * @returns Empty string when there is nothing to say.
 */
export function formatIssues (issues: readonly SpecIssue[], title = 'prop'): string {
  if (issues.length === 0)
    return ''

  const counts = {
    error:   issues.filter(issue => issue.level === 'error').length,
    warning: issues.filter(issue => issue.level === 'warning').length,
    note:    issues.filter(issue => issue.level === 'note').length,
  }
  const summary = ([ 'error', 'warning', 'note' ] as const)
    .filter(level => counts[level] > 0)
    .map(level => `${counts[level]} ${level}${counts[level] === 1 ? '' : 's'}`)
    .join(', ')

  const order = { error: 0, warning: 1, note: 2 }
  const lines = [ ...issues ]
    .sort((a, b) => order[a.level] - order[b.level])
    .map(issue => `  ${issue.level.padEnd(7)} ${issue.path}: ${issue.message}`)

  return [ `${title}: ${summary}`, ...lines ].join('\n')
}

function finish (spec: NormalizedPropSpec | null, issues: SpecIssue[], name: string): SpecReview {
  const ok = spec !== null && !issues.some(issue => issue.level === 'error')
  return {
    ok,
    spec:   ok ? spec : null,
    issues,
    report: formatIssues(issues, name) || `${name}: ok`,
  }
}

// Models like to wrap the answer: { spec: … }, { prop: … }, { result: … }.
function unwrap (value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 3; depth++) {
    if (Array.isArray(current))
      return { parts: current }
    if (!isRecord(current))
      return current

    if (Array.isArray(current.parts) || isRecord(current.parts))
      return current

    const inner = current.spec ?? current.prop ?? current.result ?? current.object
    if (inner === undefined)
      return current
    current = inner
  }
  return current
}

function readName (value: unknown, fallback: string): string {
  if (typeof value !== 'string')
    return fallback

  const cleaned = value.trim().replace(/[^\w \-.]/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

function readParts (value: unknown, add: (level: IssueLevel, path: string, message: string) => void): unknown[] {
  if (Array.isArray(value))
    return value

  // { parts: { leg: {…}, seat: {…} } } — a keyed map is a reasonable reading of
  // "named parts", so accept it and carry the keys over as names.
  if (isRecord(value)) {
    add('warning', 'parts', 'expected an array; read the object keys as part names')
    return Object.entries(value).map(([ key, part ]) => isRecord(part) ? { name: key, ...part } : part)
  }

  add('error', 'parts', 'missing — a prop is { "name": …, "parts": [ { "shape": … } ] }')
  return []
}

function readPart (
  value: unknown,
  index: number,
  taken: Set<string>,
  add: (level: IssueLevel, path: string, message: string) => void,
): NormalizedPart | null {
  const path = `parts[${index}]`
  if (!isRecord(value)) {
    add('error', path, 'expected an object like { "shape": "box", "size": [1, 1, 1] }')
    return null
  }

  const entry = applyAliases(value, path, add)
  const shape = readShape(entry.shape, `${path}.shape`, add)
  if (!shape)
    return null

  const flat   = FLAT_SHAPES.includes(shape)
  const detail = clamp(number(entry.detail) ?? PART_DEFAULTS.detail, 0, 3)
  const size   = readSize(entry.size, `${path}.size`, flat, add)

  const part: NormalizedPart = {
    name:      uniqueName(readName(entry.name, shape), taken),
    shape,
    size,
    at:        readVec3(entry.at, [ 0, 0, 0 ], 1, `${path}.at`, add),
    on:        typeof entry.on === 'string' && entry.on.trim() !== '' ? entry.on.trim() : null,
    rotate:    readVec3(entry.rotate, [ 0, 0, 0 ], 1, `${path}.rotate`, add),
    color:     readColor(entry.color, `${path}.color`, add),
    material:  readSurface(entry.material, `${path}.material`, add),
    glow:      clamp(number(entry.glow) ?? PART_DEFAULTS.glow, 0, 20),
    detail,
    sides:     Math.round(clamp(number(entry.sides) ?? (shape === 'prism' ? 6 : 16), 3, 64)),
    taper:     clamp(number(entry.taper) ?? PART_DEFAULTS.taper, 0, 8),
    thickness: clamp(number(entry.thickness) ?? PART_DEFAULTS.thickness, 0.02, 0.98),
    shadow:    entry.shadow === undefined ? PART_DEFAULTS.shadow : entry.shadow !== false,
    repeat:    readRepeat(entry.repeat, `${path}.repeat`, add),
  }

  for (const axis of [ 0, 1, 2 ] as const)
    if (Math.abs(part.at[axis]) > SPEC_LIMITS.maxOffset)
      add('warning', `${path}.at`, `${part.at[axis]}m is off the map; clamped to ±${SPEC_LIMITS.maxOffset}m`)

  part.at = [
    clamp(part.at[0], -SPEC_LIMITS.maxOffset, SPEC_LIMITS.maxOffset),
    clamp(part.at[1], -SPEC_LIMITS.maxOffset, SPEC_LIMITS.maxOffset),
    clamp(part.at[2], -SPEC_LIMITS.maxOffset, SPEC_LIMITS.maxOffset),
  ]

  return part
}

function applyAliases (
  value: Record<string, unknown>,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {}

  for (const [ key, raw ] of Object.entries(value)) {
    const lower  = key.toLowerCase()
    const target = PART_KEY_ALIASES[lower] ?? lower

    if (target !== lower || key !== lower)
      add('warning', `${path}.${key}`, `is not a field; read it as "${target}"`)

    // an alias never overwrites the real field — { size, scale } keeps size
    if (entry[target] === undefined || value[target] === undefined)
      entry[target] = raw
  }
  return entry
}

function uniqueName (base: string, taken: Set<string>): string {
  let name  = base
  let index = 2
  while (taken.has(name))
    name = `${base}-${index++}`
  taken.add(name)
  return name
}

function readShape (
  value: unknown,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): ShapeName | null {
  if (typeof value !== 'string' || value.trim() === '') {
    add('error', path, `missing. Use one of: ${SHAPE_NAMES.join(', ')}`)
    return null
  }

  const key = value.trim().toLowerCase()
    .replace(/[\s_-]+/g, '')
  if ((SHAPE_NAMES as readonly string[]).includes(key))
    return key as ShapeName

  const synonym = SHAPE_SYNONYMS[key] ?? (key.endsWith('s') ? SHAPE_SYNONYMS[key.slice(0, -1)] : undefined)
  if (synonym) {
    add('warning', path, `"${value}" is not a shape; used "${synonym}"`)
    return synonym
  }

  const guess = nearest(key, SHAPE_NAMES)
  if (guess) {
    add('warning', path, `"${value}" is not a shape; used "${guess}"`)
    return guess
  }

  add('error', path, `unknown shape "${value}". Use one of: ${SHAPE_NAMES.join(', ')}`)
  return null
}

function readSurface (
  value: unknown,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): MaterialPreset {
  if (value === undefined || value === null)
    return PART_DEFAULTS.material
  if (typeof value !== 'string') {
    add('warning', path, `expected a name like "metal"; used "${PART_DEFAULTS.material}"`)
    return PART_DEFAULTS.material
  }

  const key = value.trim().toLowerCase()
    .replace(/[\s_-]+/g, '')
  if ((SURFACE_NAMES as readonly string[]).includes(key))
    return key as MaterialPreset

  const resolved = SURFACE_SYNONYMS[key] ?? nearest(key, SURFACE_NAMES)
  if (resolved) {
    add('warning', path, `"${value}" is not a surface; used "${resolved}"`)
    return resolved
  }

  add('warning', path, `unknown surface "${value}"; used "${PART_DEFAULTS.material}". Pick from: ${SURFACE_NAMES.join(', ')}`)
  return PART_DEFAULTS.material
}

function readColor (
  value: unknown,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): string {
  if (value === undefined || value === null)
    return PART_DEFAULTS.color

  if (typeof value === 'number')
    return `#${value.toString(16).padStart(6, '0')
      .slice(-6)}`

  if (typeof value !== 'string') {
    add('warning', path, `expected a hex string like "#8a4436"; used "${PART_DEFAULTS.color}"`)
    return PART_DEFAULTS.color
  }

  const text = value.trim()
  if (HEX_COLOR.test(text))
    return text.startsWith('#') ? text.toLowerCase() : `#${text.toLowerCase()}`
  if (CSS_FUNCTION.test(text))
    return text
  if (text.toLowerCase().replace(/\s+/g, '') in THREE.Color.NAMES)
    return text.toLowerCase().replace(/\s+/g, '')

  add('warning', path, `"${value}" is not a colour; used "${PART_DEFAULTS.color}". Use hex like "#8a4436"`)
  return PART_DEFAULTS.color
}

function readSize (
  value: unknown,
  path: string,
  flat: boolean,
  add: (level: IssueLevel, path: string, message: string) => void,
): SpecVec3 {
  const size                          = readVec3(value, [ PART_DEFAULTS.size, PART_DEFAULTS.size, PART_DEFAULTS.size ], 3, path, add)
  const out: [number, number, number] = [ 0, 0, 0 ]

  for (const axis of [ 0, 1, 2 ] as const) {
    const requested = Math.abs(size[axis])
    if (flat && axis === 1) {
      out[axis] = 0
      continue
    }
    if (requested > SPEC_LIMITS.maxSize) {
      add('warning', path, `${requested}m is bigger than a prop should be; clamped to ${SPEC_LIMITS.maxSize}m`)
      out[axis] = SPEC_LIMITS.maxSize
      continue
    }
    if (requested < SPEC_LIMITS.minSize) {
      add('warning', path, `${requested}m is too small to see; clamped to ${SPEC_LIMITS.minSize}m`)
      out[axis] = SPEC_LIMITS.minSize
      continue
    }
    out[axis] = requested
  }
  return out
}

/**
 * Read a 3-vector from whatever the model produced.
 *
 * @param spread - Which axes a lone number fills: 3 spreads it over all three
 * (a cube), 1 puts it on `y` alone (a height, a yaw) — the readings that are
 * actually meant when a model writes `"size": 2` or `"rotate": 90`.
 */
function readVec3 (
  value: unknown,
  fallback: SpecVec3,
  spread: 1 | 3,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): SpecVec3 {
  if (value === undefined || value === null)
    return fallback

  const scalar = number(value)
  if (scalar !== null) {
    if (spread === 3)
      return [ scalar, scalar, scalar ]

    add('warning', path, `read the single number ${scalar} as the y component`)
    return [ 0, scalar, 0 ]
  }

  if (isRecord(value))
    return [
      number(value.x) ?? number(value.width) ?? fallback[0],
      number(value.y) ?? number(value.height) ?? fallback[1],
      number(value.z) ?? number(value.depth) ?? fallback[2],
    ]

  return readVec3List(value, fallback, path, add)
}

/** The array (or `"1, 2, 3"` string) case of {@link readVec3}. */
function readVec3List (
  value: unknown,
  fallback: SpecVec3,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): SpecVec3 {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
        .filter(Boolean)
      : null

  if (!list) {
    add('warning', path, `expected [x, y, z]; used ${JSON.stringify(fallback)}`)
    return fallback
  }

  const numbers = list.map(item => number(item))
  if (numbers.some(item => item === null)) {
    add('warning', path, `expected numbers in [x, y, z]; used ${JSON.stringify(fallback)}`)
    return fallback
  }
  if (numbers.length !== 3)
    add('warning', path, `expected 3 numbers, got ${numbers.length}; padded with ${JSON.stringify(fallback)}`)

  return [
    numbers[0] ?? fallback[0],
    numbers[1] ?? fallback[1],
    numbers[2] ?? fallback[2],
  ]
}

function readRepeat (
  value: unknown,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): NormalizedRepeat | null {
  const entry = repeatEntry(value)
  if (!entry) {
    if (value !== undefined && value !== null)
      add('warning', path, 'expected { "count": n, "mode": "linear" | "radial" | "mirror" }; ignored')
    return null
  }

  const requested = Math.round(number(entry.count) ?? 2)
  if (requested > SPEC_LIMITS.maxCopies)
    add('warning', `${path}.count`, `${requested} copies is over the limit; clamped to ${SPEC_LIMITS.maxCopies}`)

  const mode                     = readMode(entry.mode, `${path}.mode`, add)
  const axis                     = readAxis(entry.axis, mode === 'mirror' ? 'x' : 'y', `${path}.axis`, add)
  const repeat: NormalizedRepeat = {
    count:   Math.round(clamp(requested, 1, SPEC_LIMITS.maxCopies)),
    mode,
    offset:  readVec3(entry.offset, [ 0, 0, 0 ], 1, `${path}.offset`, add),
    radius:  clamp(number(entry.radius) ?? 1, 0, SPEC_LIMITS.maxOffset),
    arc:     clamp(number(entry.arc) ?? 360, -720, 720),
    axis,
    faceOut: entry.faceOut === undefined ? true : entry.faceOut !== false,
  }

  return checkedRepeat(repeat, path, add)
}

/** `"repeat": 4` is a perfectly clear thing to write, so let it mean a count. */
function repeatEntry (value: unknown): Record<string, unknown> | null {
  if (isRecord(value))
    return value

  const count = number(value)
  return count === null ? null : { count }
}

/** The two repeats that build but produce nothing worth looking at. */
function checkedRepeat (
  repeat: NormalizedRepeat,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): NormalizedRepeat {
  if (repeat.mode === 'linear' && repeat.offset.every(component => component === 0)) {
    add('warning', `${path}.offset`, 'a linear repeat with no offset stacks every copy in one place; used [1, 0, 0]')
    repeat.offset = [ 1, 0, 0 ]
  }
  if (repeat.mode === 'mirror' && repeat.count !== 2 && repeat.count !== 4)
    add('warning', `${path}.count`, `mirror makes 2 or 4 copies, not ${repeat.count}`)

  return repeat
}

const REPEAT_MODES: Record<string, RepeatMode> = {
  linear:   'linear',
  grid:     'linear',
  row:      'linear',
  line:     'linear',
  radial:   'radial',
  circular: 'radial',
  ring:     'radial',
  around:   'radial',
  mirror:   'mirror',
  mirrored: 'mirror',
  symmetry: 'mirror',
  reflect:  'mirror',
}

function readMode (
  value: unknown,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): RepeatMode {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (key === '')
    return 'linear'

  const mode = REPEAT_MODES[key]
  if (mode)
    return mode

  add('warning', path, `"${String(value)}" is not a repeat mode; used "linear"`)
  return 'linear'
}

function readAxis (
  value: unknown,
  fallback: AxisName,
  path: string,
  add: (level: IssueLevel, path: string, message: string) => void,
): AxisName {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (key === 'x' || key === 'y' || key === 'z')
    return key
  if (key !== '')
    add('warning', path, `"${String(value)}" is not an axis; used "${fallback}"`)
  return fallback
}

function number (value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim().replace(/(?:m|cm|deg|°)$/i, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clamp (value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// perf: string work only, at author time. The Levenshtein guesses run once per
// unrecognised token, never per frame.
