// lib/camera/index.ts
// Camera rigs that createApp accepts directly through its `camera` option
// (it takes a prebuilt THREE.Camera as readily as a plain options object).

export { createIsoCamera, resizeIsoCamera, aimIsoCamera } from './iso.js'
export { createFollowCamera } from './follow.js'

export type { IsoCameraOptions, IsoAimOptions } from './iso.js'
export type { FollowCamera, FollowCameraOptions } from './follow.js'
