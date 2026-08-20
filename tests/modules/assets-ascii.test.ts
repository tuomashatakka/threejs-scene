import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ASCII_SHADES, ASCII_VIEWS, auditPalette, rasterizeAscii } from 'ꭍ/assets'


/** Both tools read positions as a triangle soup, which is what mergeParts emits. */
function soup (geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.toNonIndexed()
}

const unitBox = (): THREE.BufferGeometry => soup(new THREE.BoxGeometry(1, 1, 1))

/** A soup with one flat colour baked across every vertex. */
function painted (r: number, g: number, b: number): THREE.BufferGeometry {
  const geometry = unitBox()
  const count    = geometry.getAttribute('position').count
  const colors   = new Float32Array(count * 3)

  for (let i = 0; i < count; i += 1) {
    colors[i * 3]     = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  return geometry
}

describe('rasterizeAscii', () => {
  it('draws a box and reports what it cost', () => {
    const result = rasterizeAscii(unitBox())

    expect(result.triangles).toBe(12)
    expect(result.drawn).toBeGreaterThan(0)
    expect(result.drawn).toBeLessThanOrEqual(12)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.lines.join('').trim()).not.toBe('')
  })

  it('reports the world extent it drew', () => {
    const result = rasterizeAscii(unitBox())

    expect(result.min[0]).toBeCloseTo(-0.5)
    expect(result.min[1]).toBeCloseTo(-0.5)
    expect(result.max[0]).toBeCloseTo(0.5)
    expect(result.max[2]).toBeCloseTo(0.5)
    expect(result.scale).toBeGreaterThan(0)
  })

  it('never exceeds the requested width', () => {
    const result = rasterizeAscii(unitBox(), { cols: 24 })

    for (const line of result.lines)
      expect(line.length).toBeLessThanOrEqual(24)
  })

  it('honours an explicit row count', () => {
    expect(rasterizeAscii(unitBox(), { rows: 7 }).lines).toHaveLength(7)
  })

  it('renders from every named view, and falls back to iso', () => {
    const geometry = unitBox()

    for (const view of Object.keys(ASCII_VIEWS)) {
      const result = rasterizeAscii(geometry, { view })

      expect(result.drawn).toBeGreaterThan(0)
    }

    // An unknown view name is a typo in a CLI flag, not a reason to throw.
    const fallback = rasterizeAscii(geometry, { view: 'nope' })

    expect(fallback.lines).toEqual(rasterizeAscii(geometry, { view: 'iso' }).lines)
  })

  it('is deterministic', () => {
    expect(rasterizeAscii(unitBox()).lines).toEqual(rasterizeAscii(unitBox()).lines)
  })

  // Level 0 is reserved for 'nothing here', so even near-black paint draws as
  // a glyph rather than as a hole — otherwise a missing part and a very dark
  // one are the same picture. The exact level depends on the key light, so what
  // is guaranteed is only that nothing covered comes back empty.
  it('draws dark paint as a glyph rather than a hole', () => {
    const glyphs = [ ...rasterizeAscii(painted(0.01, 0.01, 0.01)).lines.join('') ]
    const drawn  = glyphs.filter(glyph => glyph !== ' ')

    expect(drawn.length).toBeGreaterThan(0)

    for (const glyph of drawn) {
      const level = ASCII_SHADES.indexOf(glyph)

      expect(level).toBeGreaterThanOrEqual(1)
      expect(level).toBeLessThanOrEqual(3)
    }
  })

  it('shades brighter paint higher up the ramp', () => {
    const level = (geometry: THREE.BufferGeometry): number => {
      const glyphs = rasterizeAscii(geometry).lines.join('').replace(/ /g, '')

      return Math.max(...[ ...glyphs ].map(glyph => ASCII_SHADES.indexOf(glyph)))
    }

    expect(level(painted(0.95, 0.95, 0.95))).toBeGreaterThan(level(painted(0.08, 0.08, 0.08)))
  })
})

describe('auditPalette', () => {
  it('names the palette entry a baked facet came from', () => {
    const found = auditPalette(painted(1, 0, 0), { red: '#ff0000', green: '#00ff00' })

    expect(found).toHaveLength(1)
    expect(found[0]?.name).toBe('red')
    expect(found[0]?.facets).toBe(12)
    expect(found[0]?.minY).toBeCloseTo(-0.5)
    expect(found[0]?.maxY).toBeCloseTo(0.5)
  })

  it('separates hues', () => {
    const found = auditPalette(painted(0, 1, 0), { red: '#ff0000', green: '#00ff00' })

    expect(found[0]?.name).toBe('green')
  })

  // Jitter and grime are multiplicative, so they slide a colour along its own
  // brightness ray and leave its direction — and so its identity — intact.
  it('sees through a multiplicative brightness change', () => {
    const bright = auditPalette(painted(1, 0.2, 0.2), { red: '#ff3333', blue: '#3333ff' })
    const dim    = auditPalette(painted(0.3, 0.06, 0.06), { red: '#ff3333', blue: '#3333ff' })

    expect(bright[0]?.name).toBe('red')
    expect(dim[0]?.name).toBe('red')
  })

  it('answers nothing when there is nothing to answer from', () => {
    expect(auditPalette(unitBox(), { red: '#ff0000' })).toEqual([])
    expect(auditPalette(painted(1, 0, 0), {})).toEqual([])
  })
})
