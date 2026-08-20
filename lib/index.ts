// threejs-scene — curated barrel.
// Core factories + the shared type vocabulary, grouped by function:
// app (composition root), time (clock, loop), state (store, rng), render
// (renderer, resize), lifecycle (dispose), input (pointer-gesture). Behavior
// modules live in the root modules/ directory and are imported via subpaths:
//   import { orbitControls } from 'threejs-scene/modules/orbit'

export * from './types.js'

// app — the composition root
export { createApp } from './app/create-app.js'
export { defineModule } from './app/module.js'
export type { App, AppOptions, AppCameraOptions, AppSceneOptions, AppLoopOptions } from './app/create-app.js'
export type { AppModule, ModuleHandle } from './app/module.js'

// time — when things happen
export { createClock } from './time/clock.js'
export { createFrameLoop } from './time/loop.js'
export type { Clock, ClockMode, ClockOptions } from './time/clock.js'
export type { FrameLoopOptions } from './time/loop.js'

// state — what the world is
export { createStore } from './state/store.js'
export { createSeededRng, hash2, hash3, lerp, mulberry32, smoothstep, valueNoise1d } from './state/rng.js'
export { readPath, writePath, readNumberPath, readTextPath } from './state/path.js'
export type { Store, Reducer, StoreListener } from './state/store.js'

// camera — prebuilt rigs for createApp's `camera` option
export { createIsoCamera, resizeIsoCamera, aimIsoCamera, createFollowCamera } from './camera/index.js'
export type { IsoCameraOptions, IsoAimOptions, FollowCamera, FollowCameraOptions } from './camera/index.js'

// render — how it reaches the screen
export { createRenderer } from './render/renderer.js'
export { attachResizeObserver } from './render/resize.js'
export type { RendererOptions } from './render/renderer.js'
export type { ResizeHandler } from './render/resize.js'

// lifecycle — teardown
export { disposeScene, disposeMaterial, disposeMesh } from './lifecycle/dispose.js'
export type { DisposeMeshOptions } from './lifecycle/dispose.js'

// input — how intent enters the system
export { attachPointerGesture } from './input/pointer-gesture.js'
export type { PointerGestureCallbacks, PointerGestureOptions } from './input/pointer-gesture.js'
