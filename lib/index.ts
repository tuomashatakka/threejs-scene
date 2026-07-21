// @tuomashatakka/threejs-scene — curated barrel.
// Core factories + the shared type vocabulary, grouped by function:
// app (composition root), time (clock, loop), state (store, rng), render
// (renderer, resize), lifecycle (dispose), input (pointer-gesture). Behavior
// modules live in the root modules/ directory and are imported via subpaths:
//   import { orbitControls } from '@tuomashatakka/threejs-scene/modules/orbit'

export * from './types'

// app — the composition root
export { createApp } from './app/create-app'
export { defineModule } from './app/module'
export type { App, AppOptions, AppCameraOptions, AppSceneOptions, AppLoopOptions } from './app/create-app'
export type { AppModule, ModuleHandle } from './app/module'

// time — when things happen
export { createClock } from './time/clock'
export { createFrameLoop } from './time/loop'
export type { Clock, ClockMode, ClockOptions } from './time/clock'
export type { FrameLoopOptions } from './time/loop'

// state — what the world is
export { createStore } from './state/store'
export { createSeededRng, mulberry32 } from './state/rng'
export type { Store, Reducer, StoreListener } from './state/store'

// camera — prebuilt rigs for createApp's `camera` option
export { createIsoCamera, resizeIsoCamera, aimIsoCamera, createFollowCamera } from './camera/index'
export type { IsoCameraOptions, IsoAimOptions, FollowCamera, FollowCameraOptions } from './camera/index'

// render — how it reaches the screen
export { createRenderer } from './render/renderer'
export { attachResizeObserver } from './render/resize'
export type { RendererOptions } from './render/renderer'
export type { ResizeHandler } from './render/resize'

// lifecycle — teardown
export { disposeScene, disposeMaterial } from './lifecycle/dispose'

// input — how intent enters the system
export { attachPointerGesture } from './input/pointer-gesture'
export type { PointerGestureCallbacks, PointerGestureOptions } from './input/pointer-gesture'
