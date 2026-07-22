// lib/camera/follow.ts
// Third-person chase camera. The camera trails a target through an offset
// expressed in the TARGET's local space, so the rig banks and turns with it,
// and both position and look-at are exponentially smoothed — a rigid follow
// transmits every twitch of the target straight into the viewport and reads as
// nauseating.

import * as THREE from 'three'

import type { Vec3 } from '../types.js'


/** Options for {@link createFollowCamera}. */
export interface FollowCameraOptions {

  /** Offset behind/above the target, in the target's local space. @defaultValue [0, 2.2, -6] */
  offset?: Vec3

  /** Extra height added to the look-at point. @defaultValue 1 */
  lookAhead?: number

  /** Position smoothing half-life in seconds; lower = tighter. @defaultValue 0.12 */
  positionDamping?: number

  /** Look-at smoothing half-life in seconds. @defaultValue 0.08 */
  lookDamping?: number

  /** @defaultValue 55 */
  fov?: number

  /** @defaultValue 0.1 */
  near?: number

  /** @defaultValue 400 */
  far?: number
}

/** Handle returned by {@link createFollowCamera}. */
export interface FollowCamera {
  camera: THREE.PerspectiveCamera

  /**
   * Advance the rig one frame.
   *
   * @param targetPosition - World position of the followed object.
   * @param targetQuaternion - World orientation of the followed object.
   * @param delta - Seconds since the previous frame.
   */
  update (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion, delta: number): void

  /** Jump the rig to its ideal pose immediately — use on spawn/teleport. */
  snap (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): void
}

// Frame-rate-independent exponential smoothing: the fraction of the remaining
// distance to close this frame, derived from a half-life. A raw `lerp(a, b, k)`
// per frame would converge faster at high frame rates and slower at low ones.
function smoothing (halfLife: number, delta: number): number {
  if (halfLife <= 0)
    return 1
  return 1 - Math.pow(2, -delta / halfLife)
}

/**
 * Build a damped third-person chase camera.
 *
 * @returns A {@link FollowCamera}. Pass `.camera` to `createApp({ camera })` and
 * call `.update(...)` from a module's `update` hook.
 * @remarks Allocation-free per frame — all scratch vectors are hoisted.
 * @example
 * const rig = createFollowCamera({ offset: [0, 3, -8] })
 * const app = createApp(canvas, { camera: rig.camera })
 * // in a module's update(): rig.update(ship.position, ship.quaternion, frame.delta)
 */
export function createFollowCamera ({
  offset = [ 0, 2.2, -6 ],
  lookAhead = 1,
  positionDamping = 0.12,
  lookDamping = 0.08,
  fov = 55,
  near = 0.1,
  far = 400,
}: FollowCameraOptions = {}): FollowCamera {
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far)

  const localOffset  = new THREE.Vector3(...offset)
  const desired      = new THREE.Vector3()
  const desiredLook  = new THREE.Vector3()
  const smoothedLook = new THREE.Vector3()
  let initialised  = false

  function idealPosition (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): THREE.Vector3 {
    return desired.copy(localOffset).applyQuaternion(targetQuaternion)
      .add(targetPosition)
  }

  function idealLook (targetPosition: THREE.Vector3): THREE.Vector3 {
    return desiredLook.copy(targetPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, lookAhead)
  }

  function snap (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): void {
    camera.position.copy(idealPosition(targetPosition, targetQuaternion))
    smoothedLook.copy(idealLook(targetPosition))
    camera.lookAt(smoothedLook)
    initialised = true
  }

  return {
    camera,
    snap,
    update (targetPosition, targetQuaternion, delta) {
      if (!initialised)
        return snap(targetPosition, targetQuaternion)

      camera.position.lerp(idealPosition(targetPosition, targetQuaternion), smoothing(positionDamping, delta))
      smoothedLook.lerp(idealLook(targetPosition), smoothing(lookDamping, delta))
      camera.lookAt(smoothedLook)
    },
  }
}

// perf: free. Two lerps and a lookAt per frame, zero allocation.
