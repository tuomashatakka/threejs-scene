import { describe, expect, it } from 'vitest'

import { createClock } from 'Δ/time/clock'


describe('createClock', () => {
  it('wall mode echoes the real delta as a single tick', () => {
    const clock = createClock()
    expect(clock.mode).toBe('wall')
    expect([ ...clock.advance(0.016) ]).toEqual([ 0.016 ])
    expect([ ...clock.advance(0.5) ]).toEqual([ 0.5 ])
    expect(clock.elapsed()).toBeCloseTo(0.516, 10)
  })

  it('fixed mode emits whole steps only', () => {
    const clock = createClock({ mode: 'fixed', step: 0.01 })
    expect([ ...clock.advance(0.005) ]).toEqual([])
    expect([ ...clock.advance(0.006) ]).toEqual([ 0.01 ])
    expect(clock.elapsed()).toBeCloseTo(0.01, 10)
  })

  it('fixed mode emits multiple steps for a large delta', () => {
    const clock = createClock({ mode: 'fixed', step: 0.01, maxSubSteps: 5 })
    expect([ ...clock.advance(0.035) ]).toEqual([ 0.01, 0.01, 0.01 ])
  })

  it('fixed mode drops overflow past maxSubSteps instead of replaying it', () => {
    const clock = createClock({ mode: 'fixed', step: 0.01, maxSubSteps: 3 })
    expect([ ...clock.advance(10) ]).toEqual([ 0.01, 0.01, 0.01 ])
    // accumulator was zeroed — no burst on the next small advance
    expect([ ...clock.advance(0.005) ]).toEqual([])
    expect(clock.elapsed()).toBeCloseTo(0.03, 10)
  })

  it('same tick sequence produces the same elapsed total', () => {
    const a = createClock({ mode: 'fixed', step: 1 / 60 })
    const b = createClock({ mode: 'fixed', step: 1 / 60 })
    for (const delta of [ 0.016, 0.02, 0.031, 0.009 ]) {
      a.advance(delta)
      b.advance(delta)
    }
    expect(a.elapsed()).toBe(b.elapsed())
  })

  it('reset zeroes accumulator and elapsed', () => {
    const clock = createClock({ mode: 'fixed', step: 0.01 })
    clock.advance(0.025)
    clock.reset()
    expect(clock.elapsed()).toBe(0)
    expect([ ...clock.advance(0.005) ]).toEqual([])
  })
})
