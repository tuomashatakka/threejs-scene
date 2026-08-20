import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLadderMemory, describeQualitySignals, readQualitySignals } from 'Δ/index'


const LADDER = [ 'minimal', 'mobile', 'desktop', 'ultra' ] as const

type Tier = typeof LADDER[number]

/** A `Storage` that lives in a Map, so a test can read what was written. */
function memoryStorage (seed: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(seed))

  return {
    get length () {
      return entries.size
    },
    clear:      () => entries.clear(),
    key:        index => [ ...entries.keys() ][index] ?? null,
    getItem:    key => entries.get(key) ?? null,
    setItem:    (key, value) => void entries.set(key, value),
    removeItem: key => void entries.delete(key),
  }
}

function memory (storage: Storage | null, build = 'sha1'): ReturnType<typeof createLadderMemory<Tier>> {
  return createLadderMemory<Tier>({ ladder: LADDER, key: 'test.tier', build, storage })
}


afterEach(() => {
  vi.unstubAllGlobals()
})


describe('quality signals', () => {
  it('reports a plain wide machine when there is no DOM to ask', () => {
    vi.stubGlobal('matchMedia', undefined)
    vi.stubGlobal('devicePixelRatio', undefined)
    vi.stubGlobal('navigator', undefined)

    expect(readQualitySignals()).toEqual({
      coarsePointer:       false,
      compactViewport:     false,
      pixelRatio:          1,
      hardwareConcurrency: 4,
      wideViewport:        false,
    })
  })

  it('reads what the environment says', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse') }))
    vi.stubGlobal('devicePixelRatio', 3)
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })

    const signals = readQualitySignals()

    expect(signals.coarsePointer).toBe(true)
    expect(signals.pixelRatio).toBe(3)
    expect(signals.hardwareConcurrency).toBe(8)
  })

  it('takes the viewport thresholds from its options', () => {
    const asked: string[] = []

    vi.stubGlobal('matchMedia', (query: string) => {
      asked.push(query)
      return { matches: false }
    })

    readQualitySignals({ compactWidth: 500, wideWidth: 2000 })

    expect(asked).toContain('(max-width: 500px)')
    expect(asked).toContain('(min-width: 2000px)')
  })

  it('describes the signals as one line, ram included when offered', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 6 })

    const line = describeQualitySignals(readQualitySignals())

    expect(line).toContain('cores 8')
    expect(line).toContain('ram 6gb')
  })

  it('says so rather than guessing when ram is not offered', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })

    expect(describeQualitySignals(readQualitySignals())).toContain('ram ?')
  })
})

describe('ladder memory', () => {
  it('holds a step down to what was proven, and never lifts one up', () => {
    const held = memory(memoryStorage({ 'test.tier': 'sha1 mobile' }))

    expect(held.remembered).toBe('mobile')
    expect(held.clamp('ultra')).toBe('mobile')

    // Downward only: something cheaper than the verdict is still allowed.
    expect(held.clamp('minimal')).toBe('minimal')
  })

  it('ignores a verdict stamped by another build', () => {
    const stale = memory(memoryStorage({ 'test.tier': 'sha0 minimal' }))

    expect(stale.remembered).toBeNull()
    expect(stale.clamp('ultra')).toBe('ultra')
  })

  it('ignores a value that is no longer a step', () => {
    const gone = memory(memoryStorage({ 'test.tier': 'sha1 legendary' }))

    expect(gone.remembered).toBeNull()
  })

  it('ignores a stored value with no stamp at all', () => {
    expect(memory(memoryStorage({ 'test.tier': 'mobile' })).remembered).toBeNull()
  })

  it('writes the step against the build, and forgets on request', () => {
    const storage = memoryStorage()
    const fresh   = memory(storage)

    fresh.remember('desktop')
    expect(storage.getItem('test.tier')).toBe('sha1 desktop')

    fresh.forget()
    expect(storage.getItem('test.tier')).toBeNull()
  })

  it('works with no storage at all', () => {
    const none = memory(null)

    expect(none.remembered).toBeNull()
    expect(none.clamp('ultra')).toBe('ultra')
    expect(() => {
      none.remember('mobile')
      none.forget()
    }).not.toThrow()
  })

  it('survives storage that throws on write', () => {
    const hostile = { ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      } } as Storage

    expect(() => memory(hostile).remember('ultra')).not.toThrow()
  })
})
