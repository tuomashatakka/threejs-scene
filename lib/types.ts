// lib/types.ts
// Shared type vocabulary. Cross-layer contracts live here; each functional
// layer implements against these, never against each other's internals.

import type * as THREE from 'three'


/**
 * Anything that owns GPU or DOM resources and must be torn down explicitly.
 * three.js never auto-frees GPU memory.
 */
export interface Disposable {
  dispose (): void
}

/**
 * Per-frame context handed to every animated subsystem. `delta` is seconds
 * since the last tick, `elapsed` is total simulated seconds, `frame` is a
 * monotonically increasing tick counter.
 */
export interface FrameContext {
  delta:   number
  elapsed: number
  frame:   number
}

/** Per-frame subscriber invoked with the shared {@link FrameContext}. */
export type FrameCallback = (ctx: FrameContext) => void

/** Canvas / viewport dimensions in CSS pixels. */
export interface Size {
  width:  number
  height: number
}

/** Serializable 3-component tuple — positions and directions in app state. */
export type Vec3 = readonly [number, number, number]

/**
 * Frame loop contract implemented by `time/loop`. Subscribers receive real
 * frame deltas in seconds; simulation sub-stepping is the app's concern, not
 * the loop's.
 */
export interface FrameLoop extends Disposable {

  /** Subscribe to every pumped frame; returns an unsubscribe function. */
  onFrame (cb: FrameCallback): () => void

  /** Begin pumping frames. Idempotent. */
  start (): void

  /** Stop pumping without clearing subscribers. Idempotent. */
  stop (): void

  /** Whether the loop is currently pumping. */
  readonly running: boolean
}

/**
 * Seeded pseudo-random stream. `fork(label)` derives a deterministic
 * sub-stream from a label hash — seed once, fork per consumer, so build order
 * and replay never change the output.
 */
export interface SeededRng {
  next (): number
  range (min: number, max: number): number
  int (minInclusive: number, maxInclusive: number): number
  pick<T> (items: readonly T[]): T
  fork (label: string): SeededRng
}

/**
 * Context injected into every app module. Modules never reach for globals —
 * this kills init-order bugs and keeps modules testable headless.
 */
export interface SceneContext {
  scene:    THREE.Scene
  camera:   THREE.Camera
  renderer: THREE.WebGLRenderer
  rng:      SeededRng
  loop:     FrameLoop
}
