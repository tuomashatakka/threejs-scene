// lib/render/audit.ts
// What the driver thinks of the programs it was given, read before anything
// draws with one.
//
// three links every program up front — `createApp` calls `renderer.compile` on
// mount — but it does not *check* the link until the program's first use
// (`WebGLProgram.js`, `onFirstUse`). By then the broken program is already bound
// to a draw, every draw against it raises INVALID_OPERATION, and ANGLE
// eventually takes the context away. The loss lands seconds after load, at
// whatever moment the offending material first came into view, which is why it
// reads as thermal rather than as a compile error.
//
// Reading LINK_STATUS here, after compile and before the first frame, turns that
// into a blank screen with a material name on it. Nothing draws, so nothing
// cascades, so no context is lost — and the answer arrives at t=0 instead of
// never.
//
// The varying census is the other half. A mobile driver will refuse a program
// whose varyings do not fit its row budget, and the log it gives back for that
// is frequently empty — so counting the rows the program actually declares,
// with the dead `#ifdef` branches removed, is often the only way to see why.

import type { WebGLRenderer } from 'three'


export interface ProgramFault {
  name:     string
  cacheKey: string
  log:      string
  census:   string
}

/** One program's shape, as the driver was actually handed it. */
export interface ProgramCensus {
  name:       string
  linked:     boolean
  varyings:   VaryingCount[]
  components: number
  rows:       number
  attributes: number
}

export interface VaryingCount {
  name: string
  type: string
  size: number
}

/** Components per element, by GLSL type. Anything unrecognised is charged a row. */
const WIDTH: Record<string, number> = {
  float: 1,
  int:   1,
  uint:  1,
  bool:  1,
  vec2:  2,
  ivec2: 2,
  uvec2: 2,
  bvec2: 2,
  vec3:  3,
  ivec3: 3,
  uvec3: 3,
  bvec3: 3,
  vec4:  4,
  ivec4: 4,
  uvec4: 4,
  bvec4: 4,
  mat2:  4,
  mat3:  9,
  mat4:  16,
}

/** Elements a matrix occupies, since each column is packed as its own vector. */
const COLUMNS: Record<string, number> = { mat2: 2, mat3: 3, mat4: 4 }

const VARYING = /^\s*(?:varying|out)\s+(?:(?:low|medium|high)p\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/u
const DEFINE  = /^\s*#define\s+(\w+)(?:\s+(\S+))?/u
const BRANCH  = /^\s*#(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/u

/**
 * Whether a preprocessor condition holds, given what the shader has defined.
 *
 * Not a general GLSL preprocessor — a reader of the handful of forms three
 * actually writes around a varying declaration: `#ifdef X`, `#ifndef X`,
 * `#if defined( X )`, `#if NUM_DIR_LIGHT_SHADOWS > 0`, and those joined by
 * `&&` and `||`. Anything it cannot parse is treated as true, because a census
 * that over-counts is a census that errs toward reporting a problem rather than
 * hiding one.
 */
function holds (expression: string, defines: Map<string, string>): boolean {
  const term = expression.trim()

  if (term.includes('||'))
    return term.split('||').some(part => holds(part, defines))

  if (term.includes('&&'))
    return term.split('&&').every(part => holds(part, defines))

  const negated = term.startsWith('!')
  const body    = (negated ? term.slice(1) : term).trim().replace(/^\((.*)\)$/su, '$1')
    .trim()

  const isDefined = (/^defined\s*\(?\s*(\w+)\s*\)?$/u).exec(body)

  if (isDefined)
    return defines.has(isDefined[1]!) !== negated

  const comparison = (/^(\w+)\s*(>=|<=|==|!=|>|<)\s*(\d+)$/u).exec(body)

  if (comparison) {
    const left  = Number(defines.get(comparison[1]!) ?? 0)
    const right = Number(comparison[3]!)

    switch (comparison[2]) {
      case '>': return left > right !== negated
      case '<': return left < right !== negated
      case '>=': return left >= right !== negated
      case '<=': return left <= right !== negated
      case '==': return left === right !== negated
      default: return left !== right !== negated
    }
  }

  if ((/^\w+$/u).test(body))
    return Number(defines.get(body) ?? 0) !== 0 !== negated

  return !negated
}

/**
 * One `#if` and everything hanging off it.
 *
 * `taken` is per level rather than shared, because `#else` inside a dead branch
 * must stay dead — and `active` is the condition already anded with whether the
 * levels enclosing it were live, so testing liveness is one `every` over the
 * stack rather than a walk with a running flag.
 */
interface Level {
  active: boolean
  taken:  boolean
}

/** Advance the branch stack over one preprocessor line. */
function stepBranch (stack: Level[], keyword: string, rest: string, defines: Map<string, string>): void {
  const enclosing = stack.every(level => level.active)
  const current   = stack[stack.length - 1]

  if (keyword === 'endif') {
    stack.pop()
    return
  }

  if (keyword === 'else' && current) {
    const outer = stack.slice(0, -1).every(level => level.active)

    current.active = !current.taken && outer
    current.taken  = true
    return
  }

  if (keyword === 'elif' && current) {
    const outer  = stack.slice(0, -1).every(level => level.active)
    const holds_ = holds(rest, defines)

    current.active = !current.taken && holds_ && outer
    current.taken  = current.taken || holds_
    return
  }

  const target    = rest.trim()
  const condition = keyword === 'ifdef'
    ? holds(`defined(${target})`, defines)
    : keyword === 'ifndef'
      ? !holds(`defined(${target})`, defines)
      : holds(rest, defines)

  stack.push({ active: condition && enclosing, taken: condition })
}

/**
 * Every varying the vertex stage actually emits, with the dead branches gone.
 *
 * `getShaderSource` hands back the source three assembled — includes resolved,
 * prefix attached — but not preprocessed, so the `#ifdef`s and the `#define`s
 * that decide them are both still in the text. Walking the two together is the
 * only way to learn that, say, `flatShading` means `vNormal` was never declared
 * at all. Counting the declarations flat would say the opposite.
 */
export function readVaryings (source: string): VaryingCount[] {
  const defines               = new Map<string, string>()
  const found: VaryingCount[] = []
  const stack: Level[]        = []

  for (const line of source.split('\n')) {
    const branch = BRANCH.exec(line)

    if (branch) {
      stepBranch(stack, branch[1]!, branch[2] ?? '', defines)
      continue
    }

    if (!stack.every(level => level.active))
      continue

    const define = DEFINE.exec(line)

    if (define) {
      defines.set(define[1]!, define[2] ?? '1')
      continue
    }

    const declared = readDeclaration(line, defines)

    if (declared)
      found.push(declared)
  }

  return found
}

/** One line, if it declares a varying this census should charge for. */
function readDeclaration (line: string, defines: Map<string, string>): VaryingCount | null {
  // `layout(...) out vec4 pc_fragColor;` is a fragment output, not a varying,
  // and nothing declared on a `gl_` name is ours to count.
  if ((/^\s*layout/u).test(line))
    return null

  const varying = VARYING.exec(line)

  if (!varying)
    return null

  const [ , type, name, length ] = varying

  if (!(type! in WIDTH) || name!.startsWith('gl_'))
    return null

  const size = length ? Number(defines.get(length) ?? length) : 1

  return Number.isFinite(size) && size > 0
    ? { name: name!, type: type!, size }
    : null
}

/**
 * Rows the driver has to find for these varyings.
 *
 * The limit that bites is `MAX_VARYING_COMPONENTS / 4` — fifteen rows of four
 * on the handset in question, against thirty on a desktop — and packing, not
 * the raw component sum, is what runs out. Arrays and matrices never share a
 * row; `vec3`s take one each and let a `float` ride along in the spare column;
 * `vec2`s pair up. Close enough to the spec's algorithm to be worth printing,
 * and rounded toward pessimism where it is not.
 */
export function packedRows (varyings: VaryingCount[]): number {
  let rows   = 0
  let vec3s  = 0
  let vec2s  = 0
  let floats = 0

  for (const { type, size } of varyings) {
    const columns = COLUMNS[type] ?? 1
    const width   = (WIDTH[type] ?? 4) / columns
    const total   = size * columns

    if (size > 1 || columns > 1 || width === 4) {
      rows += total
      continue
    }

    if (width === 3)
      vec3s += 1
    else if (width === 2)
      vec2s += 1
    else
      floats += 1
  }

  rows += vec3s
  floats = Math.max(0, floats - vec3s)
  rows += Math.ceil(vec2s / 2)
  rows += Math.ceil(floats / 4)

  return rows
}

/** The vertex shader three handed the driver, as the driver received it. */
function vertexSource (gl: WebGL2RenderingContext, program: WebGLProgram): string {
  for (const shader of gl.getAttachedShaders(program) ?? [])
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER)
      return gl.getShaderSource(shader) ?? ''

  return ''
}

/** One program, measured rather than assumed. */
export function censusProgram (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): ProgramCensus {
  const varyings = readVaryings(vertexSource(gl, program))

  return {
    name,
    linked:     gl.getProgramParameter(program, gl.LINK_STATUS) === true,
    varyings,
    components: varyings.reduce((sum, v) => sum + (WIDTH[v.type] ?? 4) * v.size, 0),
    rows:       packedRows(varyings),
    attributes: Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) ?? 0),
  }
}

/** A census as one line, against the budget the device actually reported. */
export function describeCensus (census: ProgramCensus, rowLimit: number): string {
  const varyings = census.varyings
    .map(v => `${v.name}:${v.type}${v.size > 1 ? `[${v.size}]` : ''}`)
    .join(' ')

  return [
    `${census.linked ? 'ok  ' : 'FAIL'} ${census.name}`,
    `${census.rows}/${rowLimit} rows`,
    `${census.components}c`,
    `${census.attributes} attribs`,
    varyings || 'no varyings',
  ].join(' · ')
}

/** How many rows of four this device will pack varyings into. */
export function varyingRowLimit (gl: WebGL2RenderingContext): number {
  return Math.floor(Number(gl.getParameter(gl.MAX_VARYING_COMPONENTS) ?? 60) / 4)
}

/**
 * Every program the renderer has built, measured.
 *
 * `renderer.info.programs` is three's own program cache, and each entry carries
 * the material name the program was compiled for — which is the only handle on
 * a driver that declines to link and declines to say why.
 */
export function censusPrograms (renderer: WebGLRenderer): ProgramCensus[] {
  const gl = renderer.getContext() as WebGL2RenderingContext

  return (renderer.info.programs ?? []).flatMap(entry => {
    const program = entry.program as WebGLProgram | null

    return program
      ? [ censusProgram(gl, program, entry.name || `(unnamed ${entry.cacheKey.slice(0, 12)})`) ]
      : []
  })
}

/**
 * The programs the driver refused, with its reason if it gave one.
 *
 * Called after `createApp` and before the first frame. An empty result is a
 * real finding and not an absence of one: it rules link failure out as the
 * cause of a context loss, which no run so far has been able to do.
 */
export function auditPrograms (renderer: WebGLRenderer): ProgramFault[] {
  const gl       = renderer.getContext() as WebGL2RenderingContext
  const rowLimit = varyingRowLimit(gl)

  return (renderer.info.programs ?? []).flatMap(entry => {
    const program = entry.program as WebGLProgram | null

    if (!program || gl.getProgramParameter(program, gl.LINK_STATUS) === true)
      return []

    const name    = entry.name || '(unnamed)'
    const census  = censusProgram(gl, program, name)
    const message = (gl.getProgramInfoLog(program) ?? '').trim()

    return [{
      name,
      cacheKey: entry.cacheKey,
      log:      message || 'the driver gave no reason',
      census:   describeCensus(census, rowLimit),
    }]
  })
}

/** Where the audit says its piece — any logger with these two methods. */
export interface AuditReport {
  say(message: string): void
  fail(message: string): void
}

/**
 * Read every program's verdict out loud, and say whether the app may draw.
 *
 * `true` means keep the loop stopped. That is the entire fix for the context
 * loss: the draws are what turn a refused program into a dead context, so an
 * app that never starts cannot lose one — and the reader gets the failing
 * material's name instead of a black screen and a browser that has quietly
 * blocklisted the origin.
 */
export function reportPrograms (renderer: WebGLRenderer, report: AuditReport, auditOnly: boolean): boolean {
  const gl       = renderer.getContext() as WebGL2RenderingContext
  const rowLimit = varyingRowLimit(gl)
  const faults   = auditPrograms(renderer)
  const built    = renderer.info.programs?.length ?? 0

  if (faults.length) {
    report.fail(`${faults.length} of ${built} programs failed to link · not drawing`)

    for (const fault of faults) {
      report.fail(`${fault.name} · ${fault.log}`)
      report.fail(fault.census)
    }
  }
  else
    // An empty audit is a result, not a silence: it rules link failure out as
    // the cause of a loss, which a black screen cannot tell you.
    report.say(`${built} programs linked · ${rowLimit} varying rows to spend`)

  if (auditOnly) {
    for (const census of censusPrograms(renderer))
      report.say(describeCensus(census, rowLimit))

    report.say('audit only · built, measured, and never drawn')
  }

  return faults.length > 0 || auditOnly
}

// perf: two `getProgramParameter` calls and a source parse per program, once,
// after the scene is built and before it draws.  Nothing here runs on the frame path.
