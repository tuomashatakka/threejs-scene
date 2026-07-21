import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frameLoopManager } from '@tuomashatakka/canvas-loop-framecapper'

import { createFrameLoop } from './loop.js'

import type { FrameLoop } from '../types.js'


let rafCallbacks: FrameRequestCallback[] = []
let loops: FrameLoop[]                   = []

function track (loop: FrameLoop): FrameLoop {
  loops.push(loop)
  return loop
}

/** Drive the shared manager's rAF loop manually with an absolute timestamp. */
function pumpFrame (time: number): void {
  const cb            = rafCallbacks[rafCallbacks.length - 1]
  rafCallbacks.length = 0
  cb?.(time)
}

beforeEach(() => {
  rafCallbacks = []
  loops        = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  for (const loop of loops)
    loop.dispose()
  frameLoopManager.setFixedFrameRate(0)
  frameLoopManager.reset()
  vi.unstubAllGlobals()
})

describe('createFrameLoop', () => {
  it('starts stopped and pumps real deltas in seconds once started', () => {
    const loop            = track(createFrameLoop())
    const ticks: number[] = []
    loop.onFrame(({ delta }) => ticks.push(delta))

    expect(loop.running).toBe(false)
    pumpFrame(performance.now())
    expect(ticks).toEqual([])

    loop.start()
    expect(loop.running).toBe(true)

    const base = performance.now()
    pumpFrame(base + 10)
    pumpFrame(base + 26)
    expect(ticks).toHaveLength(2)
    // second delta is exactly the timestamp spacing, in seconds
    expect(ticks[1]).toBeCloseTo(0.016, 6)
  })

  it('increments frame and accumulates elapsed per subscriber tick', () => {
    const loop                                       = track(createFrameLoop())
    const seen: { frame: number, elapsed: number }[] = []
    loop.onFrame(({ frame, elapsed }) => seen.push({ frame, elapsed }))
    loop.start()

    const base = performance.now()
    pumpFrame(base + 10)
    pumpFrame(base + 20)
    pumpFrame(base + 30)
    expect(seen.map(s => s.frame)).toEqual([ 1, 2, 3 ])
    expect(seen[2]!.elapsed).toBeGreaterThan(seen[1]!.elapsed)
  })

  it('stop detaches from the shared manager without clearing subscribers', () => {
    const loop            = track(createFrameLoop())
    const ticks: number[] = []
    loop.onFrame(({ frame }) => ticks.push(frame))
    loop.start()

    const base = performance.now()
    pumpFrame(base + 10)
    loop.stop()
    expect(loop.running).toBe(false)

    loop.start()
    pumpFrame(base + 40)
    expect(ticks).toEqual([ 1, 2 ])
  })

  it('unsubscribing removes a single subscriber', () => {
    const loop        = track(createFrameLoop())
    const a: number[] = []
    const b: number[] = []
    const offA        = loop.onFrame(({ frame }) => a.push(frame))
    loop.onFrame(({ frame }) => b.push(frame))
    loop.start()

    const base = performance.now()
    pumpFrame(base + 10)
    offA()
    pumpFrame(base + 20)
    expect(a).toEqual([ 1 ])
    expect(b).toEqual([ 1, 2 ])
  })

  it('independent loops start and stop without affecting one another', () => {
    const first       = track(createFrameLoop())
    const second      = track(createFrameLoop())
    const a: number[] = []
    const b: number[] = []
    first.onFrame(({ frame }) => a.push(frame))
    second.onFrame(({ frame }) => b.push(frame))

    first.start()
    second.start()

    const base = performance.now()
    pumpFrame(base + 10)

    first.stop()
    pumpFrame(base + 20)
    expect(a).toEqual([ 1 ])
    expect(b).toEqual([ 1, 2 ])
  })

  it('fps cap yields fixed deltas of exactly 1/fps', () => {
    const loop            = track(createFrameLoop({ fps: 50 }))
    const ticks: number[] = []
    loop.onFrame(({ delta }) => ticks.push(delta))
    loop.start()

    const base = performance.now()
    pumpFrame(base + 10) // accumulator below 20ms — skipped
    pumpFrame(base + 20) // one 20ms step consumed
    expect(ticks).toEqual([ 1 / 50 ])
  })

  it('dispose stops the loop and clears subscribers', () => {
    const loop            = createFrameLoop()
    const ticks: number[] = []
    loop.onFrame(({ frame }) => ticks.push(frame))
    loop.start()
    loop.dispose()

    pumpFrame(performance.now() + 10)
    expect(loop.running).toBe(false)
    expect(ticks).toEqual([])
  })
})
