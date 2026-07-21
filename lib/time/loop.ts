// lib/time/loop.ts
// Frame loop backed by @tuomashatakka/canvas-loop-framecapper. The
// framecapper's shared FrameLoopManager owns the single requestAnimationFrame
// on the page; each createFrameLoop() keeps its own subscriber set, frame
// counter and elapsed time, so independent loops start/stop without affecting
// one another. Subscribers receive REAL frame deltas in seconds — simulation
// sub-stepping through a Clock is the app's concern, not the loop's.

import { frameLoopManager } from '@tuomashatakka/canvas-loop-framecapper'

import type { FrameCallback, FrameLoop } from '../types'


/** Options for {@link createFrameLoop}. */
export interface FrameLoopOptions {

  /**
   * Cap the loop at a fixed frame rate (fps > 0, 0 = uncapped). Capped frames
   * always receive delta = 1/fps. NOTE: the cap is set on the shared
   * FrameLoopManager, so it applies to every loop on the page.
   */
  fps?: number
}

/**
 * Create a frame loop sharing one `requestAnimationFrame` with every other
 * loop on the page via the framecapper's shared FrameLoopManager.
 *
 * The loop starts stopped — call `start()` to pump. `start` registers one
 * sync callback on the shared manager and resumes it; `stop` unregisters,
 * leaving the manager (and any other loops) untouched.
 *
 * @param options - Optional fps cap; see {@link FrameLoopOptions}.
 * @returns A {@link FrameLoop}. `dispose()` stops the loop and clears subscribers.
 */
export function createFrameLoop ({ fps }: FrameLoopOptions = {}): FrameLoop {
  const subscribers = new Set<FrameCallback>()
  let frame   = 0
  let elapsed = 0
  let running = false

  if (fps !== undefined)
    frameLoopManager.setFixedFrameRate(fps)

  // perf: one shared rAF, one Set iteration per frame. zero allocations.
  function pump (): void {
    const delta = frameLoopManager.deltaTime
    frame   += 1
    elapsed += delta
    for (const cb of subscribers)
      cb({ delta, elapsed, frame })
  }

  function start (): void {
    if (running)
      return
    running = true
    frameLoopManager.registerSyncCallback(pump)
    frameLoopManager.resume()
  }

  function stop (): void {
    if (!running)
      return
    running = false
    frameLoopManager.unregisterSyncCallback(pump)
  }

  return {
    onFrame (cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    start,
    stop,
    get running () {
      return running
    },
    dispose () {
      stop()
      subscribers.clear()
    },
  }
}
