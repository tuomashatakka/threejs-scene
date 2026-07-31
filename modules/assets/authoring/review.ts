// modules/assets/authoring/review.ts
// The critic.
//
// Validation answers "is this buildable?". It is not the interesting question —
// a small model's specs are almost always buildable and quite often wrong: the
// tabletop hovers a metre above its legs, the wheels are buried inside the
// chassis, the whole thing floats. Nobody notices, because the model cannot see
// what it made.
//
// So the critic measures the BUILT prop and reports what a person would say
// looking at it: it floats, that part is buried, those two are detached, that
// one is inside-out big. Those notes go back in the next turn, and the second
// attempt is usually right. This is the difference between a schema and a
// framework.

import * as THREE from 'three'

import type { Prop } from '../prop.js'
import type { SpecIssue } from './validate.js'


/** Measurements and critique of a built prop. */
export interface PropReview {

  /** Prop name. */
  name: string

  /** Meshes in the prop, after repetition. */
  meshes: number

  /** Total triangles across every mesh. */
  triangles: number

  /** World-space size of the whole prop, in metres. */
  size: [number, number, number]

  /** Lowest and highest point, in metres. */
  bottom: number
  top:    number

  /** What a person would say looking at it. Empty when it reads fine. */
  notes: SpecIssue[]

  /** One line of measurements plus the notes, ready for a tool result. */
  report: string
}

/** Tolerances, in metres. Below these a gap is a rounding error, not a mistake. */
const TOUCH_EPSILON  = 0.02
const GROUND_EPSILON = 0.05

interface Piece {
  name: string
  box:  THREE.Box3
}

function collect (prop: Prop): Piece[] {
  prop.updateMatrixWorld(true)

  const pieces: Piece[] = []
  prop.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh)
      return

    const box = new THREE.Box3().setFromObject(mesh)
    if (!box.isEmpty())
      pieces.push({ name: mesh.name || 'part', box })
  })
  return pieces
}

function triangleCount (prop: Prop): number {
  let total = 0
  prop.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry)
      return

    const geometry = mesh.geometry
    const vertices = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0
    total += Math.floor(vertices / 3)
  })
  return total
}

/** Union-find over "these two boxes touch", so a prop in two halves is visible. */
function components (pieces: Piece[]): number[][] {
  const parent = pieces.map((_, index) => index)
  const find   = (index: number): number => {
    let root = index
    while (parent[root] !== root)
      root = parent[root] as number
    return root
  }

  const grown = pieces.map(piece => piece.box.clone().expandByScalar(TOUCH_EPSILON))
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++)
      if ((grown[i] as THREE.Box3).intersectsBox(grown[j] as THREE.Box3))
        parent[find(i)] = find(j)

  const groups = new Map<number, number[]>()
  for (let i = 0; i < pieces.length; i++) {
    const root = find(i)
    groups.set(root, [ ...groups.get(root) ?? [], i ])
  }
  return [ ...groups.values() ]
}

function round (value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded // never report -0
}

function names (pieces: Piece[], indices: number[], limit = 4): string {
  const listed = indices.slice(0, limit).map(index => (pieces[index] as Piece).name)
  return indices.length > limit ? `${listed.join(', ')}, +${indices.length - limit} more` : listed.join(', ')
}

/**
 * Measure a built prop and critique its geometry.
 *
 * @returns A {@link PropReview}. `notes` are advice, never errors — a floating
 * cloud is fine, a floating chair is not, and only the author knows which one
 * this is.
 * @example
 * const review = reviewProp(buildProp(spec))
 * console.log(review.report)
 * // chair: 5 meshes, 1.1k triangles, 0.5 × 0.9 × 0.5m, sits on the ground
 */
export function reviewProp (prop: Prop): PropReview {
  const pieces    = collect(prop)
  const triangles = triangleCount(prop)
  const bounds    = new THREE.Box3()
  for (const piece of pieces)
    bounds.union(piece.box)

  const size = bounds.isEmpty()
    ? new THREE.Vector3()
    : bounds.getSize(new THREE.Vector3())

  const notes: SpecIssue[] = pieces.length === 0
    ? [{ level: 'note', path: 'prop', message: 'nothing was built — every part is empty' }]
    : [
      ...checkGround(bounds),
      ...checkConnected(pieces),
      ...checkBuried(pieces),
      ...checkDuplicates(pieces),
      ...checkBudget(size, triangles),
    ]

  const headline = pieces.length === 0
    ? `${prop.name}: empty`
    : `${prop.name}: ${pieces.length} meshes, ${formatCount(triangles)} triangles, ` +
      `${round(size.x)} × ${round(size.y)} × ${round(size.z)}m, ` +
      `${describeGround(bounds.min.y)}`

  return {
    name:   prop.name,
    meshes: pieces.length,
    triangles,
    size:   [ round(size.x), round(size.y), round(size.z) ],
    bottom: round(bounds.isEmpty() ? 0 : bounds.min.y),
    top:    round(bounds.isEmpty() ? 0 : bounds.max.y),
    notes,
    report: [ headline, ...notes.map(entry => `  note    ${entry.path}: ${entry.message}`) ].join('\n'),
  }
}

function note (path: string, message: string): SpecIssue {
  return { level: 'note', path, message }
}

/** Does it stand on the floor, or hover / sink through it? */
function checkGround (bounds: THREE.Box3): SpecIssue[] {
  if (bounds.min.y > GROUND_EPSILON)
    return [ note('prop', `floats ${round(bounds.min.y)}m above the ground — lower every part's "at" y by that much, or say it is meant to hover`) ]
  if (bounds.min.y < -GROUND_EPSILON)
    return [ note('prop', `sinks ${round(-bounds.min.y)}m below the ground — a part's "at" y should be at least half its height`) ]
  return []
}

/** Is it one object, or several things in a bag? */
function checkConnected (pieces: Piece[]): SpecIssue[] {
  const groups = components(pieces)
  if (groups.length <= 1)
    return []

  const detached = [ ...groups ].sort((a, b) => b.length - a.length)
    .slice(1)
  return [ note(
    'prop',
    `${groups.length} pieces are not connected: ${detached.map(group => names(pieces, group)).join(' | ')}` +
      ' — move them until they touch, or accept a floating part',
  ) ]
}

/**
 * Is any part invisible inside another?
 *
 * @remarks The margin matters: a spot ON a dome sits inside the dome's BOX, and
 * flagging that would teach the model to pull its details off the surface. Only
 * a part buried well clear of the outer surface is actually invisible.
 */
function checkBuried (pieces: Piece[]): SpecIssue[] {
  const shrunk = pieces.map(piece => {
    const margin = piece.box.getSize(new THREE.Vector3()).multiplyScalar(-0.12)
    return piece.box.clone().expandByVector(margin)
  })

  const notes: SpecIssue[] = []
  for (const [ i, inner ] of pieces.entries())
    for (const [ j, outer ] of pieces.entries())
      if (i !== j && (shrunk[j] as THREE.Box3).containsBox(inner.box))
        notes.push(note(inner.name, `is completely inside "${outer.name}" and cannot be seen`))
  return notes
}

/** Two parts in exactly the same place — one of them is paying for nothing. */
function checkDuplicates (pieces: Piece[]): SpecIssue[] {
  const notes: SpecIssue[] = []
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = (pieces[i] as Piece).box
      const b = (pieces[j] as Piece).box
      if (a.min.distanceTo(b.min) < TOUCH_EPSILON && a.max.distanceTo(b.max) < TOUCH_EPSILON)
        notes.push(note((pieces[j] as Piece).name, `is in the same place as "${(pieces[i] as Piece).name}" — one of them is wasted`))
    }
  return notes
}

/** Is it prop-sized, and can the GPU afford it? */
function checkBudget (size: THREE.Vector3, triangles: number): SpecIssue[] {
  const notes: SpecIssue[] = []
  const longest            = Math.max(size.x, size.y, size.z)

  if (longest > 20)
    notes.push(note('prop', `${round(longest)}m across is scenery, not a prop — check the units, sizes are in metres`))
  if (longest < 0.05)
    notes.push(note('prop', `${round(longest)}m across is too small to see — sizes are in metres`))
  if (triangles > 40000)
    notes.push(note('prop', `${triangles} triangles is heavy for one prop — drop "detail" or use fewer parts`))
  return notes
}

function describeGround (bottom: number): string {
  if (Math.abs(bottom) <= GROUND_EPSILON)
    return 'sits on the ground'
  return bottom > 0 ? `floats ${round(bottom)}m up` : `sunk ${round(-bottom)}m into the ground`
}

function formatCount (value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

// perf: O(n²) over parts, and n is capped at a few dozen — microseconds. Run it
// at author time, never per frame.
