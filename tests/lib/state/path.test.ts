import { describe, expect, it } from 'vitest'

import { readNumberPath, readPath, readTextPath, withPath, writePath } from 'Δ/index'


describe('dotted config paths', () => {
  it('reads and writes a nested leaf', () => {
    const config = { look: { bloom: 0.4, name: 'dusk' }}

    expect(readPath(config, 'look.bloom')).toBe(0.4)

    writePath(config, 'look.bloom', 0.9)
    expect(config.look.bloom).toBe(0.9)
  })

  it('reads a top-level leaf', () => {
    const config = { tier: 'mobile' }

    expect(readPath(config, 'tier')).toBe('mobile')
    writePath(config, 'tier', 'ultra')
    expect(config.tier).toBe('ultra')
  })

  // Paths arrive from urls and stored preference snapshots, both of which go
  // stale. A dead key must not throw on boot.
  it('is total on a dead path, reading and writing', () => {
    const config = { look: { bloom: 0.4 }}

    expect(readPath(config, 'look.missing')).toBeUndefined()
    expect(readPath(config, 'nope.nope.nope')).toBeUndefined()
    expect(readPath(config, '')).toBeUndefined()
    expect(readPath(config, 'look.bloom.deeper')).toBeUndefined()

    expect(() => writePath(config, 'nope.nope', 1)).not.toThrow()
    expect(() => writePath(config, '', 1)).not.toThrow()
    expect(config).toEqual({ look: { bloom: 0.4 }})
  })

  it('coerces through the typed readers, with fallbacks', () => {
    const config = { look: { bloom: 0.4, name: 'dusk' }}

    expect(readNumberPath(config, 'look.bloom')).toBe(0.4)
    expect(readNumberPath(config, 'look.name')).toBe(0)
    expect(readNumberPath(config, 'look.missing', -1)).toBe(-1)

    expect(readTextPath(config, 'look.name')).toBe('dusk')
    expect(readTextPath(config, 'look.bloom')).toBe('')
    expect(readTextPath(config, 'look.missing', 'fallback')).toBe('fallback')
  })
})


describe('withPath', () => {
  type SampleReturnType = { look: { bloom: number, grade: string }, camera: { viewSize: number }}

  const sample = (): SampleReturnType => ({
    look:   { bloom: 0.4, grade: 'noir' },
    camera: { viewSize: 30 },
  })

  it('writes the leaf without mutating what it wrote into', () => {
    const before = sample()
    const after  = withPath(before, 'look.bloom', 0.9)

    expect(after.look.bloom).toBe(0.9)
    expect(before.look.bloom).toBe(0.4)
  })

  it('copies the spine and keeps everything off it by reference', () => {
    const before = sample()
    const after  = withPath(before, 'look.bloom', 0.9)

    expect(after).not.toBe(before)
    expect(after.look).not.toBe(before.look)
    expect(after.camera).toBe(before.camera)
  })

  it('returns the same object when the leaf already held the value', () => {
    const before = sample()

    expect(withPath(before, 'look.bloom', 0.4)).toBe(before)
    expect(withPath(before, 'look.grade', 'noir')).toBe(before)
  })

  it('is silent on a dead path, exactly as writePath is', () => {
    const before = sample()

    expect(withPath(before, 'nowhere.at.all', 1)).toBe(before)
    expect(withPath(before, '', 1)).toBe(before)
    expect(withPath(before, 'look..bloom', 1)).toBe(before)
  })

  it('writes a top-level leaf', () => {
    const before = { seed: 1, look: { bloom: 0.4 }}
    const after  = withPath(before, 'seed', 7)

    expect(after.seed).toBe(7)
    expect(after.look).toBe(before.look)
  })

  it('agrees with writePath on where the value lands', () => {
    const mutated = sample()
    const copied  = withPath(sample(), 'camera.viewSize', 42)

    writePath(mutated, 'camera.viewSize', 42)

    expect(copied).toEqual(mutated)
  })
})
