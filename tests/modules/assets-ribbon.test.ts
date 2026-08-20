import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  ball,
  blade,
  box,
  cone,
  createSurfaceRibbon,
  cyl,
  deg,
  hedron,
  plank,
  ribbonIndices,
  spread,
  traceSections,
} from 'ꭍ/assets'


const LINE = [{ x: 0, z: 0 }, { x: 0, z: 10 }]

describe('traceSections', () => {
  it('resamples at a fixed arc length and always reaches the end', () => {
    const sections = traceSections(LINE, 1)

    expect(sections).toHaveLength(11)
    expect(sections[0]?.along).toBe(0)
    expect(sections.at(-1)?.along).toBe(10)
    expect(sections.at(-1)?.z).toBe(10)

    for (let i = 0; i < 10; i += 1)
      expect(sections[i]?.along).toBeCloseTo(i)
  })

  it('emits unit normals in the ground plane', () => {
    for (const section of traceSections(LINE, 2))
      expect(Math.hypot(section.normalX, section.normalZ)).toBeCloseTo(1)
  })

  // Smoothed polylines routinely carry repeated points; a zero-length segment
  // has no normal, so it has to be skipped rather than divided by.
  it('skips zero-length segments', () => {
    const sections = traceSections([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 4 }], 1)

    expect(sections).toHaveLength(5)
    for (const section of sections)
      expect(Number.isFinite(section.normalX)).toBe(true)
  })

  it('returns nothing for a degenerate path or step', () => {
    expect(traceSections([{ x: 0, z: 0 }], 1)).toHaveLength(0)
    expect(traceSections(LINE, 0)).toHaveLength(0)
    expect(traceSections(LINE, -1)).toHaveLength(0)
  })
})

describe('ribbonIndices', () => {
  it('winds two triangles per quad', () => {
    expect(ribbonIndices(0, 3, 5)).toHaveLength((3 - 1) * (5 - 1) * 6)
    expect(ribbonIndices(0, 1, 5)).toHaveLength(0)
  })

  it('offsets every corner by `first`', () => {
    const base    = ribbonIndices(0, 3, 3)
    const shifted = ribbonIndices(100, 3, 3)

    expect(shifted).toEqual(base.map(index => index + 100))
  })
})

describe('createSurfaceRibbon', () => {
  const across = [ -1, 0, 1 ]

  it('builds one vertex per edge per section', () => {
    const geometry = createSurfaceRibbon({ path: LINE, across, step: 1, heightAt: () => 0 })

    expect(geometry).not.toBeNull()
    expect(geometry?.getAttribute('position').count).toBe(11 * 3)
    expect(geometry?.getAttribute('uv').count).toBe(11 * 3)
    expect(geometry?.getIndex()?.count).toBe(10 * 2 * 6)
    expect(geometry?.getAttribute('normal')).toBeTruthy()
  })

  it('takes its height from the callback', () => {
    const geometry = createSurfaceRibbon({ path: LINE, across, step: 1, heightAt: () => 5 })
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute

    for (let i = 0; i < position.count; i += 1)
      expect(position.getY(i)).toBeCloseTo(5)
  })

  it('lays the edges out across the ground-plane normal', () => {
    const geometry = createSurfaceRibbon({ path: LINE, across, step: 1, heightAt: () => 0 })
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute

    // A +z segment's normal points along -x, so the outer edges land at ±1 in x.
    expect(position.getX(0)).toBeCloseTo(1)
    expect(position.getX(1)).toBeCloseTo(0)
    expect(position.getX(2)).toBeCloseTo(-1)
  })

  it('shifts the whole cross-section by centreAt', () => {
    const geometry = createSurfaceRibbon({
      path:     LINE,
      across,
      step:     1,
      heightAt: () => 0,
      centreAt: () => 4,
    })
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute

    expect(position.getX(1)).toBeCloseTo(-4)
  })

  it('only carries colour when something colours it', () => {
    const plainRibbon = createSurfaceRibbon({ path: LINE, across, step: 1, heightAt: () => 0 })

    expect(plainRibbon?.getAttribute('color')).toBeUndefined()

    const painted = createSurfaceRibbon({
      path:     LINE,
      across,
      step:     1,
      heightAt: () => 0,
      colorAt:  (vertex, target) => target.setRGB(vertex.u, vertex.v, 0),
    })
    const colour = painted?.getAttribute('color') as THREE.BufferAttribute

    expect(colour.count).toBe(11 * 3)
    // u runs 0 → 1 across the ribbon, v runs 0 → 1 along it.
    expect(colour.getX(0)).toBeCloseTo(0)
    expect(colour.getX(2)).toBeCloseTo(1)
    expect(colour.getY(0)).toBeCloseTo(0)
    expect(colour.getY(colour.count - 1)).toBeCloseTo(1)
  })

  it('is deterministic', () => {
    const build = (): THREE.BufferGeometry | null => createSurfaceRibbon({
      path:     LINE,
      across,
      step:     0.7,
      heightAt: (x, z) => Math.sin(x) + z * 0.1,
    })

    const a = build()?.getAttribute('position').array
    const b = build()?.getAttribute('position').array

    expect(Array.from(a ?? [])).toEqual(Array.from(b ?? []))
  })

  it('returns null when there is nothing to build', () => {
    expect(createSurfaceRibbon({ path: [{ x: 0, z: 0 }], across, heightAt: () => 0 })).toBeNull()
    expect(createSurfaceRibbon({ path: LINE, across: [ 0 ], heightAt: () => 0 })).toBeNull()
  })
})

describe('primitives', () => {
  it('builds a positioned geometry for each shape', () => {
    const shapes = [
      box(1, 2, 3),
      cyl(0.5, 0.6, 2),
      cone(1, 2),
      ball(1),
      hedron(1),
      plank(4, 0.1, 0.6),
      blade(0.2, 1),
    ]

    for (const shape of shapes) {
      expect(shape).toBeInstanceOf(THREE.BufferGeometry)
      expect(shape.getAttribute('position').count).toBeGreaterThan(0)
      shape.dispose()
    }
  })

  // part() transforms and bakes into the geometry it is handed, so two props
  // sharing one instance would corrupt each other.
  it('returns a fresh instance every call', () => {
    const first  = box(1, 1, 1)
    const second = box(1, 1, 1)

    expect(first).not.toBe(second)
    first.dispose()
    second.dispose()
  })

  // Segments are the reason blade exists: applyTaper/applyBend move vertices,
  // and an unsegmented box tapers into a wedge and refuses to bend at all.
  it('segments a blade up its length', () => {
    const flat      = box(0.2, 1, 0.08)
    const segmented = blade(0.2, 1, 4)

    expect(segmented.getAttribute('position').count).toBeGreaterThan(flat.getAttribute('position').count)
    flat.dispose()
    segmented.dispose()
  })

  it('converts degrees and spreads offsets', () => {
    expect(deg(180)).toBeCloseTo(Math.PI)
    expect(deg(0)).toBe(0)

    expect(spread(1, 10)).toEqual([ 0 ])
    expect(spread(0, 10)).toEqual([ 0 ])
    expect(spread(3, 10)).toEqual([ -5, 0, 5 ])
    expect(spread(2, 4)).toEqual([ -2, 2 ])
  })
})
