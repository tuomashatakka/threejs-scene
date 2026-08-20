import { describe, expect, it } from 'vitest'

import { readNumberPath, readPath, readTextPath, writePath } from 'Δ/index'


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
