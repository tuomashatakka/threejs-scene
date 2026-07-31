import { describe, expect, it } from 'vitest'

import { createSeededRng, hash2, hash3, lerp, mulberry32, smoothstep } from 'Δ/state/rng'


describe('mulberry32', () => {
  it('same seed produces the same stream', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 20; i++)
      expect(a()).toBe(b())
  })

  it('yields uniform values in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('createSeededRng', () => {
  it('range and int stay inside their bounds', () => {
    const rng = createSeededRng(1)
    for (let i = 0; i < 200; i++) {
      const r = rng.range(-2, 3)
      expect(r).toBeGreaterThanOrEqual(-2)
      expect(r).toBeLessThan(3)

      const n = rng.int(1, 6)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(6)
      expect(Number.isInteger(n)).toBe(true)
    }
  })

  it('pick returns an element and throws on an empty array', () => {
    const rng = createSeededRng(1)
    expect([ 'a', 'b', 'c' ]).toContain(rng.pick([ 'a', 'b', 'c' ]))
    expect(() => rng.pick([])).toThrow(/empty array/)
  })

  it('fork is label-stable regardless of sibling fork order', () => {
    const first  = createSeededRng(5)
    const second = createSeededRng(5)

    const grassFirst = first.fork('grass')
    first.fork('rocks')

    second.fork('rocks')

    const grassSecond = second.fork('grass')

    for (let i = 0; i < 10; i++)
      expect(grassFirst.next()).toBe(grassSecond.next())
  })

  it('different seeds produce different streams', () => {
    const a    = createSeededRng(1)
    const b    = createSeededRng(2)
    const same = Array.from({ length: 10 }, () => a.next() === b.next())
    expect(same).toContain(false)
  })
})

describe('stateless rng math', () => {
  it('hashes coordinates deterministically into [0, 1)', () => {
    expect(hash2(3, 7)).toBe(hash2(3, 7))
    expect(hash3(3, 7, 11)).toBe(hash3(3, 7, 11))
    expect(hash2(3, 7)).toBeGreaterThanOrEqual(0)
    expect(hash2(3, 7)).toBeLessThan(1)
    expect(hash3(3, 7, 11)).not.toBe(hash3(3, 7, 12))
  })

  it('interpolates and smoothsteps, including equal edges', () => {
    expect(lerp(2, 6, 0.25)).toBe(3)
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(2, 2, 1)).toBe(0)
    expect(smoothstep(2, 2, 3)).toBe(1)
  })
})
