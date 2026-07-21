// lib/camera/iso.ts
// Isometric orthographic rig. True isometry rotates 45° around y and tilts to
// atan(1/√2) ≈ 35.264°, which makes the three axes foreshorten equally. Game
// "isometric" is usually dimetric — a 30° tilt, which reads better for tiles —
// so both are offered and dimetric is the default.

import * as THREE from 'three'

import type { Vec3 } from '../types'


/** Options for {@link createIsoCamera}. */
export interface IsoCameraOptions {

  /** Vertical world-units visible; the frustum widens from this by aspect. @defaultValue 20 */
  viewSize?: number

  /** `dimetric` (30° tilt, game-style) or `true-iso` (35.264°). @defaultValue 'dimetric' */
  flavor?: 'dimetric' | 'true-iso'

  /** Yaw around y in degrees. @defaultValue 45 */
  rotation?: number

  /** @defaultValue 0.1 */
  near?: number

  /** @defaultValue 500 */
  far?: number

  /** Point the rig looks at. @defaultValue [0, 0, 0] */
  target?: Vec3
}

/** Pose overrides for {@link aimIsoCamera}; anything omitted keeps its current value. */
export interface IsoAimOptions {

  /** Elevation above the ground plane in degrees — lower reads flatter, more first-person. */
  tilt?: number

  /** Yaw around y in degrees. */
  rotation?: number

  /** Point the rig looks at. */
  target?: Vec3

  /** Distance from the target. Cosmetic for an ortho projection; it only has to clear the clip planes. */
  radius?: number
}

/**
 * Re-aim an existing iso camera without rebuilding it — the runtime half of
 * {@link createIsoCamera}. Every field is optional and falls back to the pose
 * the camera already has (stored in `userData` by both functions), so
 * `aimIsoCamera(camera, { tilt: 22 })` swings the elevation while keeping the
 * yaw, target, and distance intact.
 *
 * @param camera - A camera from {@link createIsoCamera}.
 * @param aim - Pose overrides in degrees / world units; see {@link IsoAimOptions}.
 * @remarks Only moves the camera. Zoom is a frustum change — write
 * `camera.userData.viewSize` and call {@link resizeIsoCamera}.
 * @example
 * // flatten the rig as the view zooms in
 * aimIsoCamera(camera, { tilt: 34 - zoom * 6 })
 */
export function aimIsoCamera (camera: THREE.OrthographicCamera, aim: IsoAimOptions = {}): void {
  const data    = camera.userData
  const tiltDeg = aim.tilt ?? (data.tilt as number | undefined) ?? 30
  const yawDeg  = aim.rotation ?? (data.rotation as number | undefined) ?? 45
  const target  = aim.target ?? (data.target as Vec3 | undefined) ?? [ 0, 0, 0 ]
  const radius  = aim.radius ?? (data.radius as number | undefined) ?? 100
  const tilt    = THREE.MathUtils.degToRad(tiltDeg)
  const yaw     = THREE.MathUtils.degToRad(yawDeg)
  const horizon = radius * Math.cos(tilt)

  camera.position.set(
    target[0] + Math.cos(yaw) * horizon,
    target[1] + Math.sin(tilt) * radius,
    target[2] + Math.sin(yaw) * horizon,
  )
  camera.lookAt(target[0], target[1], target[2])

  data.tilt     = tiltDeg
  data.rotation = yawDeg
  data.target   = target
  data.radius   = radius
}

/**
 * Build an orthographic isometric camera.
 *
 * @param aspect - Viewport aspect ratio (width / height).
 * @returns An {@link THREE.OrthographicCamera} positioned on the iso axis. Its
 * `userData.viewSize` and `userData.target` are stored for {@link resizeIsoCamera},
 * plus `tilt`/`rotation`/`radius` for {@link aimIsoCamera}.
 * @remarks Pass the result straight into `createApp({ camera })` — the app
 * accepts a prebuilt camera. Ortho cameras are NOT handled by the built-in
 * resize (it only fixes perspective aspect), so call {@link resizeIsoCamera}
 * from a module `resize` hook.
 * @example
 * const camera = createIsoCamera(canvas.clientWidth / canvas.clientHeight, { viewSize: 24 })
 * createApp(canvas, { camera })
 */
export function createIsoCamera (aspect: number, {
  viewSize = 20,
  flavor = 'dimetric',
  rotation = 45,
  near = 0.1,
  far = 500,
  target = [ 0, 0, 0 ],
}: IsoCameraOptions = {}): THREE.OrthographicCamera {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const halfHeight = viewSize / 2
  const halfWidth  = halfHeight * safeAspect
  const camera     = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, near, far)

  const tilt = flavor === 'true-iso' ? Math.atan(1 / Math.SQRT2) : THREE.MathUtils.degToRad(30)
  // Distance is arbitrary for an ortho projection (no foreshortening) — it only
  // has to clear the far plane's near side, so park it well outside the scene.
  const radius = Math.min(far * 0.4, 100)

  camera.userData.viewSize = viewSize
  aimIsoCamera(camera, { tilt: THREE.MathUtils.radToDeg(tilt), rotation, target, radius })
  return camera
}

/**
 * Re-derive an iso camera's frustum after a viewport change.
 *
 * @param camera - A camera from {@link createIsoCamera} (reads `userData.viewSize`).
 * @param aspect - New viewport aspect ratio (width / height).
 * @remarks Zoom by writing `camera.userData.viewSize` before calling this.
 */
export function resizeIsoCamera (camera: THREE.OrthographicCamera, aspect: number): void {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const viewSize   = (camera.userData.viewSize as number | undefined) ?? 20
  const halfHeight = viewSize / 2
  const halfWidth  = halfHeight * safeAspect

  camera.left   = -halfWidth
  camera.right  = halfWidth
  camera.top    = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()
}

// perf: free. An ortho camera costs the same as any other; no LOD needed, but
// distant decoration still benefits from culling.
