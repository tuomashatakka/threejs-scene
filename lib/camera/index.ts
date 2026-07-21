// lib/camera/index.ts
// Camera rigs that createApp accepts directly through its `camera` option
// (it takes a prebuilt THREE.Camera as readily as a plain options object).

export { createIsoCamera, resizeIsoCamera } from './iso'
export { createFollowCamera } from './follow'

export type { IsoCameraOptions } from './iso'
export type { FollowCamera, FollowCameraOptions } from './follow'
