// modules/assets/kit.ts
// A post-apocalyptic prop kit, built from primitives.
//
// Every builder returns ONE merged, vertex-coloured geometry, which is the shape
// the rest of the pipeline wants: hand it to `new THREE.Mesh` for a hero prop,
// or to `scatterInstances` for four hundred of them in a single draw call.
//
// Everything is seeded. `buildKitGeometry('crag')` returns the same crag every
// time; `buildKitGeometry('crag', { rng })` returns a different one per call but
// the same sequence for the same seed — so a whole wasteland replays identically
// from one number.

import * as THREE from 'three'

import { createSeededRng } from '../../lib/index.js'

import { Prop, markShared } from './prop.js'
import { kitMaterial } from './facets.js'
import { mergeParts, part } from './parts.js'

import type { SeededRng, Vec3 } from '../../lib/index.js'


/** The kit's shared colour vocabulary. Override any entry per build. */
export const KIT_PALETTE = {
  concrete:     '#8d8579',
  concreteWorn: '#7f776b',
  concreteDark: '#6f6a61',
  interior:     '#746c60',
  rebar:        '#3c332c',
  steel:        '#5a5f66',
  steelDark:    '#4a4640',
  panel:        '#c4bcb0',
  panelWorn:    '#aaa298',
  wood:         '#6b5138',
  woodDark:     '#5c452f',
  woodLight:    '#7a5c3e',
  bark:         '#4d4038',
  rubber:       '#2c2c30',
  glass:        '#2f2b26',
  canvas:       '#907c58',
  tarp:         '#8a4b2d',
  rust:         '#943f2c',
  toxic:        '#5d7042',
  rock:         '#8a6f52',
  rockWorn:     '#77624c',
  rockDark:     '#6b5844',
  scrub:        '#6d6a45',
  sign:         '#4a6b52',
  signPost:     '#8b9188',
} as const

/** Name of a {@link KIT_PALETTE} entry. */
export type KitPaletteKey = keyof typeof KIT_PALETTE

/** Every prop the kit can build. */
export const KIT_PROP_NAMES = [
  'ruined-block',
  'crumbled-building',
  'container',
  'crate-stack',
  'watchtower',
  'pylon',
  'wreck-car',
  'dead-tree',
  'barrel-cluster',
  'rubble-pile',
  'barricade',
  'tire-stack',
  'road-sign',
  'crag',
] as const

/** Name of a prop in {@link KIT_PROP_NAMES}. */
export type KitPropName = (typeof KIT_PROP_NAMES)[number]

/** Options for {@link buildKitGeometry} and {@link kitProp}. */
export interface KitOptions {

  /**
   * Deterministic variation. Omit and the prop is built from a stream seeded by
   * its own name — same prop every call, which is what a test wants and what a
   * single hero prop wants.
   */
  rng?: SeededRng

  /** Colour overrides, by {@link KIT_PALETTE} key. */
  palette?: Partial<Record<KitPaletteKey, THREE.ColorRepresentation>>
}

type Palette = Record<KitPaletteKey, THREE.ColorRepresentation>

interface BuildContext {
  rng:    SeededRng
  colors: Palette
  range:  (min: number, max: number) => number
  pick:   <T>(items: readonly T[]) => T
  spin:   () => Vec3
}

const box   = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d)
const cyl   = (rt: number, rb: number, h: number, sides: number): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, sides)
const cone  = (r: number, h: number, sides: number): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, sides)
const tetra = (r: number): THREE.BufferGeometry => new THREE.TetrahedronGeometry(r)

// ── the builders ─────────────────────────────────────────────────────────────

/** A half-standing concrete shell: two walls up, two collapsed, slab through it. */
function ruinedBlock ({ rng, colors, range, pick, spin }: BuildContext): THREE.BufferGeometry {
  const parts = [
    part(box(3.4, 2.6, 0.22), { at: [ 0, 1.3, 1.19 ], color: colors.concrete, jitter: 0.08, rng }),
    part(box(3.4, 1.3, 0.22), { at: [ 0, 0.65, -1.19 ], color: colors.concreteWorn, jitter: 0.08, rng }),
    part(box(0.22, 2.2, 2.6), { at: [ 1.59, 1.1, 0 ], color: colors.concrete, jitter: 0.08, rng }),
    part(box(0.22, 0.9, 2.6), { at: [ -1.59, 0.45, 0 ], color: colors.concreteWorn, jitter: 0.08, rng }),
    part(box(3.0, 0.16, 2.2), { at: [ -0.1, 1.28, 0.1 ], rotate: [ 0.14, 0, -0.08 ], color: '#837b6f', jitter: 0.07, rng }),
  ]

  for (let i = 0; i < 3; i++)
    parts.push(part(tetra(range(0.22, 0.4)), {
      at:     [ range(-1.4, 1.4), range(1.2, 2.5), pick([ 1.15, -1.15 ]) + range(-0.1, 0.1) ],
      rotate: spin(),
      color:  colors.concrete,
      jitter: 0.1,
      rng,
    }))

  // bent rebar poking out of the broken tops — the detail that reads as "ruin"
  for (let i = 0; i < 3; i++)
    parts.push(part(cyl(0.02, 0.02, 0.7, 3), {
      at:     [ range(-1.5, 1.5), range(2.2, 2.9), range(-1, 1) ],
      rotate: [ range(-0.4, 0.4), 0, range(-0.4, 0.4) ],
      color:  colors.rebar,
      jitter: 0.04,
      rng,
    }))

  for (let i = 0; i < 4; i++)
    parts.push(part(pick([ tetra(range(0.18, 0.32)), box(range(0.2, 0.45), 0.2, range(0.2, 0.4)) ]), {
      at:     [ range(-2, 2), 0.1, range(-1.6, 1.6) ],
      rotate: [ 0, rng.next() * 3, 0 ],
      color:  colors.concreteWorn,
      jitter: 0.1,
      rng,
    }))

  return mergeParts(parts, { grime: 2.6 })
}

/** Two storeys, one corner gone, the floor slab exposed. */
function crumbledBuilding ({ rng, colors, range, pick, spin }: BuildContext): THREE.BufferGeometry {
  const parts = [
    part(box(0.24, 4.2, 3.6), { at: [ 2.05, 2.1, 0 ], color: colors.concrete, jitter: 0.07, rng }),
    part(box(2.6, 4.2, 0.24), { at: [ 0.9, 2.1, 1.7 ], color: colors.concrete, jitter: 0.07, rng }),
    part(box(1.8, 3.1, 0.24), { at: [ 1.25, 1.55, -1.7 ], color: colors.concrete, jitter: 0.08, rng }),
    part(box(1.4, 1.1, 0.24), { at: [ -0.6, 0.55, -1.7 ], color: colors.interior, jitter: 0.09, rng }),
    part(box(0.24, 0.9, 3.6), { at: [ -2.05, 0.45, 0 ], color: colors.interior, jitter: 0.09, rng }),
    part(box(2.6, 0.2, 3.3), { at: [ 0.85, 2.15, 0 ], color: '#837b6f', jitter: 0.06, rng }),
    part(box(2.4, 0.18, 3.4), { at: [ 1.0, 4.12, 0 ], rotate: [ 0, 0, -0.06 ], color: colors.concreteWorn, jitter: 0.07, rng }),
    part(box(2.3, 0.2, 3.0), { at: [ -1.35, 1.15, 0.1 ], rotate: [ 0.1, 0, 0.62 ], color: '#837b6f', jitter: 0.08, rng }),
  ]

  for (const y of [ 1.1, 3.15 ])
    for (const z of [ -0.85, 0.85 ])
      parts.push(part(box(0.1, 0.75, 0.6), { at: [ 2.1, y, z ], color: colors.glass, jitter: 0.04, rng }))

  for (let i = 0; i < 7; i++)
    parts.push(part(pick([ tetra(range(0.28, 0.55)), box(range(0.35, 0.7), range(0.22, 0.42), range(0.3, 0.6)) ]), {
      at:     [ range(-2.6, -0.8), range(0.08, 0.5), range(-1.6, 1.6) ],
      rotate: spin(),
      color:  pick([ colors.concrete, colors.interior, colors.concreteDark ]),
      jitter: 0.1,
      rng,
    }))

  for (let i = 0; i < 4; i++)
    parts.push(part(cyl(0.022, 0.022, 0.85, 3), {
      at:     [ range(-2, 2.1), range(2.6, 4.4), range(-1.5, 1.5) ],
      rotate: [ range(-0.5, 0.5), 0, range(-0.5, 0.5) ],
      color:  colors.rebar,
      jitter: 0.04,
      rng,
    }))

  return mergeParts(parts, { grime: 4.3 })
}

/** A shipping container. Built pale so a per-instance tint can paint it. */
function container ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  const parts = [ part(box(3.0, 1.28, 1.3), { at: [ 0, 0.64, 0 ], color: colors.panel, jitter: 0.045, rng }) ]

  for (let i = -2; i <= 2; i++)
    parts.push(part(box(0.09, 1.3, 1.34), { at: [ i * 0.56, 0.65, 0 ], color: colors.panelWorn, jitter: 0.04, rng }))

  parts.push(part(box(0.06, 1.2, 1.24), { at: [ 1.52, 0.64, 0 ], color: '#918a80', jitter: 0.05, rng }))
  for (const z of [ 0.3, -0.3 ])
    parts.push(part(cyl(0.03, 0.03, 1.16, 4), { at: [ 1.56, 0.64, z ], color: colors.steelDark, jitter: 0.04, rng }))

  return mergeParts(parts, { grime: 1.35 })
}

/** A pallet with crates stacked on it, one knocked off to the side. */
function crateStack ({ rng, colors, pick }: BuildContext): THREE.BufferGeometry {
  const parts = [ part(box(1.1, 0.08, 1.1), { at: [ 0, 0.04, 0 ], color: colors.woodDark, jitter: 0.1, rng }) ]

  for (const [ x, z ] of [[ -0.28, -0.28 ], [ 0.3, -0.26 ], [ -0.26, 0.3 ], [ 0.3, 0.3 ]] as const)
    parts.push(part(box(0.52, 0.52, 0.52), {
      at:     [ x, 0.34, z ],
      rotate: [ 0, rng.next() * 0.4, 0 ],
      color:  pick([ colors.woodLight, colors.wood, '#84643f' ]),
      jitter: 0.1,
      rng,
    }))

  parts.push(part(box(0.52, 0.52, 0.52), { at: [ 0.02, 0.88, 0 ], rotate: [ 0, rng.next() * 0.8, 0 ], color: colors.woodLight, jitter: 0.1, rng }))
  parts.push(part(box(0.5, 0.5, 0.5), { at: [ -0.6, 0.25, -0.55 ], rotate: [ 0, 0.5, 0 ], color: colors.wood, jitter: 0.1, rng }))

  return mergeParts(parts, { grime: 1.2 })
}

/** Four leaning legs, a platform, a rail, and a tin roof. */
function watchtower ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  const lean                          = 0.115
  const parts: THREE.BufferGeometry[] = []

  for (const [ sx, sz ] of [[ 1, 1 ], [ 1, -1 ], [ -1, 1 ], [ -1, -1 ]] as const)
    parts.push(part(box(0.14, 3.1, 0.14), {
      at:     [ sx * 0.72, 1.55, sz * 0.72 ],
      rotate: [ -sz * lean, 0, sx * lean ],
      color:  colors.wood,
      jitter: 0.09,
      rng,
    }))

  parts.push(part(box(1.9, 0.9, 0.09), { at: [ 0, 0.9, 0.62 ], rotate: [ 0, 0, 0.7 ], color: colors.woodDark, jitter: 0.09, rng }))
  parts.push(part(box(0.09, 0.9, 1.9), { at: [ -0.62, 1.6, 0 ], rotate: [ 0.7, 0, 0 ], color: colors.woodDark, jitter: 0.09, rng }))
  parts.push(part(box(2.0, 0.16, 2.0), { at: [ 0, 3.15, 0 ], color: colors.wood, jitter: 0.07, rng }))

  for (const [ sx, sz ] of [[ 1, 1 ], [ 1, -1 ], [ -1, 1 ], [ -1, -1 ]] as const)
    parts.push(part(box(0.07, 0.6, 0.07), { at: [ sx * 0.94, 3.5, sz * 0.94 ], color: colors.wood, jitter: 0.08, rng }))

  for (const z of [ 0.94, -0.94 ])
    parts.push(part(box(2.0, 0.06, 0.06), { at: [ 0, 3.78, z ], color: colors.wood, jitter: 0.08, rng }))
  for (const x of [ 0.94, -0.94 ])
    parts.push(part(box(0.06, 0.06, 2.0), { at: [ x, 3.78, 0 ], color: colors.wood, jitter: 0.08, rng }))

  parts.push(part(cone(1.55, 0.8, 4), { at: [ 0, 4.35, 0 ], rotate: [ 0, Math.PI / 4, 0 ], color: colors.tarp, jitter: 0.08, rng }))

  return mergeParts(parts, { grime: 4.4 })
}

/** A power pylon: footing, tapered mast, two crossarms, insulators. */
function pylon ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  const parts = [
    part(box(0.9, 0.3, 0.9), { at: [ 0, 0.15, 0 ], color: colors.concreteDark, jitter: 0.07, rng }),
    part(cyl(0.14, 0.38, 7, 4), { at: [ 0, 3.65, 0 ], rotate: [ 0, Math.PI / 4, 0 ], color: colors.steel, jitter: 0.06, rng }),
    part(box(2.7, 0.13, 0.13), { at: [ 0, 5.6, 0 ], color: colors.steel, jitter: 0.06, rng }),
    part(box(1.9, 0.13, 0.13), { at: [ 0, 6.45, 0 ], color: colors.steel, jitter: 0.06, rng }),
  ]

  for (const x of [ -1.2, 1.2, -0.8, 0.8 ])
    parts.push(part(cyl(0.045, 0.045, 0.26, 4), {
      at:     [ x, (Math.abs(x) > 1 ? 5.6 : 6.45) - 0.19, 0 ],
      color:  '#33302c',
      jitter: 0.04,
      rng,
    }))

  return mergeParts(parts, { grime: 6.8 })
}

/** A burnt-out car: body, cabin, sprung bonnet, three wheels on and one off. */
function wreckCar ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  const body  = '#7a7268'
  const parts = [
    part(box(2.2, 0.52, 1.1), { at: [ 0, 0.5, 0 ], rotate: [ 0, 0, 0.02 ], color: body, jitter: 0.05, rng }),
    part(box(1.15, 0.44, 1.0), { at: [ -0.14, 0.96, 0 ], rotate: [ 0, 0, 0.05 ], color: '#3a4046', jitter: 0.03, rng }),
    part(box(0.7, 0.1, 1.0), { at: [ 0.85, 0.78, 0 ], rotate: [ 0, 0, -0.35 ], color: body, jitter: 0.06, rng }),
  ]

  for (const [ x, z ] of [[ 0.72, 0.6 ], [ -0.72, 0.6 ], [ -0.72, -0.6 ]] as const)
    parts.push(part(cyl(0.27, 0.27, 0.2, 7), { at: [ x, 0.27, z ], rotate: [ Math.PI / 2, 0, 0 ], color: '#26262a', jitter: 0.04, rng }))

  // the fourth wheel, thrown clear
  parts.push(part(cyl(0.27, 0.27, 0.2, 7), { at: [ 1.55, 0.1, 0.95 ], rotate: [ 0.2, 0, 1.3 ], color: colors.rubber, jitter: 0.04, rng }))

  return mergeParts(parts, { grime: 1.2 })
}

/** A dead conifer: leaning trunk, three broken limbs, no canopy. */
function deadTree ({ rng, colors, range }: BuildContext): THREE.BufferGeometry {
  const parts = [
    part(cyl(0.08, 0.22, 2.6, 5), { at: [ 0, 1.3, 0 ], rotate: [ 0, 0, range(-0.08, 0.08) ], color: colors.bark, jitter: 0.09, rng }),
  ]

  for (let i = 0; i < 3; i++) {
    const angle = rng.next() * Math.PI * 2
    parts.push(part(cyl(0.035, 0.08, range(0.9, 1.4), 4), {
      at:     [ Math.cos(angle) * 0.32, range(1.3, 2.3), Math.sin(angle) * 0.32 ],
      rotate: [ Math.sin(angle) * range(0.6, 1.05), 0, -Math.cos(angle) * range(0.6, 1.05) ],
      color:  colors.bark,
      jitter: 0.1,
      rng,
    }))
  }

  return mergeParts(parts, { grime: 2.6 })
}

/** Three oil drums, one on its side. */
function barrelCluster ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  const drum = (x: number, z: number, color: THREE.ColorRepresentation, tipped: boolean): void => {
    if (tipped) {
      parts.push(part(cyl(0.4, 0.4, 0.95, 8), { at: [ x, 0.4, z ], rotate: [ Math.PI / 2, rng.next() * 3, 0 ], color, jitter: 0.07, rng }))
      return
    }
    parts.push(part(cyl(0.4, 0.4, 0.95, 8), { at: [ x, 0.48, z ], color, jitter: 0.07, rng }))
    for (const y of [ 0.24, 0.72 ])
      parts.push(part(cyl(0.43, 0.43, 0.05, 8), { at: [ x, y, z ], color: '#3f3a34', jitter: 0.05, rng }))
  }

  drum(0, 0, colors.toxic, false)
  drum(0.78, 0.28, colors.rust, false)
  drum(-0.45, 0.8, colors.concreteDark, true)

  return mergeParts(parts, { grime: 1.0 })
}

/** A heap of broken concrete with one bent bar through it. */
function rubblePile ({ rng, colors, range, pick, spin }: BuildContext): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  for (let i = 0; i < 6; i++)
    parts.push(part(pick([ tetra(range(0.25, 0.55)), box(range(0.3, 0.6), range(0.2, 0.4), range(0.3, 0.55)) ]), {
      at:     [ range(-0.7, 0.7), range(0.08, 0.3), range(-0.7, 0.7) ],
      rotate: spin(),
      color:  pick([ colors.concrete, colors.concreteWorn, colors.concreteDark ]),
      jitter: 0.1,
      rng,
    }))

  parts.push(part(cyl(0.02, 0.02, 0.9, 3), { at: [ 0.2, 0.35, -0.1 ], rotate: [ range(-1, 1), 0, range(0.6, 1.2) ], color: colors.rebar, jitter: 0.04, rng }))

  return mergeParts(parts, { grime: 0.8 })
}

/** Stacked sandbags behind a sheet of corrugated steel. */
function barricade ({ rng, colors, range }: BuildContext): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  for (const [ count, y ] of [[ 4, 0 ], [ 3, 0.34 ], [ 2, 0.66 ]] as const)
    for (let i = 0; i < count; i++)
      parts.push(part(new THREE.SphereGeometry(0.34, 5, 4), {
        at:     [ (i - (count - 1) / 2) * 0.58 + range(-0.04, 0.04), y + 0.2, range(-0.05, 0.05) ],
        rotate: [ 0, rng.next() * 0.6, 0 ],
        scale:  [ 1.15, 0.62, 0.85 ],
        color:  colors.canvas,
        jitter: 0.11,
        rng,
      }))

  parts.push(part(box(1.5, 1.05, 0.07), { at: [ 0.3, 0.6, -0.55 ], rotate: [ -0.4, 0.12, 0 ], color: colors.steel, jitter: 0.09, rng }))
  parts.push(part(cyl(0.05, 0.07, 1.3, 4), { at: [ -1.15, 0.6, -0.3 ], rotate: [ 0.2, 0, 0.25 ], color: colors.wood, jitter: 0.09, rng }))

  return mergeParts(parts, { grime: 1.1 })
}

/** Four tyres stacked, the top one slipping off. */
function tireStack ({ rng, colors, range }: BuildContext): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  for (let i = 0; i < 4; i++)
    parts.push(part(new THREE.TorusGeometry(0.4, 0.17, 6, 10), {
      at:     [ range(-0.06, 0.06), 0.17 + i * 0.31, range(-0.06, 0.06) ],
      rotate: [ Math.PI / 2 + (i === 3 ? 0.22 : 0), rng.next() * 3, 0 ],
      color:  colors.rubber,
      jitter: 0.05,
      rng,
    }))

  return mergeParts(parts, { grime: 1.3 })
}

/** A leaning highway sign, face bleached out. */
function roadSign ({ rng, colors }: BuildContext): THREE.BufferGeometry {
  return mergeParts([
    part(cyl(0.045, 0.06, 2.5, 5), { at: [ 0, 1.25, 0 ], rotate: [ 0, 0, 0.13 ], color: colors.steel, jitter: 0.07, rng }),
    part(box(1.55, 0.85, 0.02), { at: [ 0.31, 2.35, -0.02 ], rotate: [ 0, 0.06, 0.13 ], color: colors.signPost, jitter: 0.05, rng }),
    part(box(1.42, 0.72, 0.04), { at: [ 0.31, 2.35, 0 ], rotate: [ 0, 0.06, 0.13 ], color: colors.sign, jitter: 0.09, rng }),
  ], { grime: 2.6 })
}

/** A rock formation for the map rim: shards on a buried slab. */
function crag ({ rng, colors, range, pick, spin }: BuildContext): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  for (let i = 0; i < 6; i++)
    parts.push(part(tetra(range(1.6, 3.2)), {
      at:     [ range(-1.8, 1.8), range(0.4, 2.6), range(-1.8, 1.8) ],
      rotate: spin(),
      scale:  [ 1, range(1.1, 1.9), 1 ],
      color:  pick([ colors.rock, colors.rockWorn, colors.rockDark ]),
      jitter: 0.09,
      rng,
    }))

  parts.push(part(box(range(2.4, 3.4), range(1.2, 2), range(2, 3)), {
    at:     [ 0, 0.7, 0 ],
    rotate: [ range(-0.15, 0.15), rng.next() * 3, range(-0.15, 0.15) ],
    color:  colors.rockWorn,
    jitter: 0.08,
    rng,
  }))

  return mergeParts(parts, { grime: 4 })
}

const BUILDERS: Record<KitPropName, (ctx: BuildContext) => THREE.BufferGeometry> = {
  'ruined-block':      ruinedBlock,
  'crumbled-building': crumbledBuilding,
  container,
  'crate-stack':       crateStack,
  watchtower,
  pylon,
  'wreck-car':         wreckCar,
  'dead-tree':         deadTree,
  'barrel-cluster':    barrelCluster,
  'rubble-pile':       rubblePile,
  barricade,
  'tire-stack':        tireStack,
  'road-sign':         roadSign,
  crag,
}

// A stable seed per prop name, so an unseeded build is reproducible AND the
// props do not all come out of the same corner of the stream.
function nameSeed (name: string): number {
  let hash = 2166136261 >>> 0
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Build one kit prop as a single merged geometry.
 *
 * @returns A non-indexed, vertex-coloured geometry with its base at `y = 0`.
 * The caller owns it — dispose it, or hand it to a {@link Prop} that will.
 * @remarks Pair it with {@link kitMaterial}; a whole kit shares one material.
 * @example
 * const mesh = new THREE.Mesh(buildKitGeometry('watchtower'), material)
 * const varied = buildKitGeometry('crag', { rng: rng.fork('crags') })
 */
export function buildKitGeometry (name: KitPropName, { rng, palette }: KitOptions = {}): THREE.BufferGeometry {
  const stream = rng ?? createSeededRng(nameSeed(name))
  const colors = { ...KIT_PALETTE, ...palette } as Palette

  return BUILDERS[name]({
    rng:   stream,
    colors,
    range: (min, max) => stream.range(min, max),
    pick:  items => stream.pick(items),
    spin:  () => [ stream.next() * 3, stream.next() * 3, stream.next() * 3 ],
  })
}

/**
 * Build one kit prop as a disposable {@link Prop}.
 *
 * @param material - Share one across the kit. A material passed in is tagged
 * with `markShared`, so this prop will not dispose something its neighbours are
 * still drawing with; omit it and the prop owns a fresh {@link kitMaterial}.
 * @returns A {@link Prop} with a single part, `body`.
 * @remarks For more than a handful of the same prop, use
 * {@link scatterInstances} instead — this is one draw call *each*.
 * @example
 * const tower = kitProp('watchtower', { material: shared })
 * scene.add(tower)
 */
export function kitProp (
  name: KitPropName,
  { material, ...options }: KitOptions & { material?: THREE.Material } = {},
): Prop {
  const mesh         = new THREE.Mesh(buildKitGeometry(name, options), material ? markShared(material) : kitMaterial())
  mesh.castShadow    = true
  mesh.receiveShadow = true
  return new Prop(name).addPart('body', mesh)
}

// perf: one geometry per prop TYPE, a few hundred to a few thousand triangles
// each. Build once at load; never per frame. Scatter them with an InstancedMesh
// and the whole kit is one draw call per type.
