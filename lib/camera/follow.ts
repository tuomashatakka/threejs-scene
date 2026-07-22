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

  /**
   * Look-at point in the TARGET's local space. Set it to aim the rig somewhere
   * other than the target itself — `[0, 0.3, 24]` looks down the target's nose,
   * which is what a cockpit view needs. Overrides {@link lookAhead} when set.
   */
  lookOffset?: Vec3 | null

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

  /**
   * Re-aim the rig. Offsets are in the target's local space, so moving between
   * two stations is a lerp of their fields — no extra transition machinery.
   *
   * Damping is part of a station for a reason: exponential smoothing against a
   * moving target leaves a steady-state lag of roughly speed × half-life. A
   * chase camera wants that lag (it is the drift that reads as weight); a
   * camera mounted *inside* the target must not have it, or it trails outside
   * the hull. Set `positionDamping: 0` for anything rigidly attached.
   *
   * @param station - Fields to change. Anything omitted is left alone.
   */
  aim (station: FollowCameraStation): void
}

/** A camera preset for {@link FollowCamera.aim}. Every field is optional. */
export interface FollowCameraStation {

  /** Seat position in the target's local space. */
  offset?: Vec3

  /** Look-at point in the target's local space. `null` restores `lookAhead`. */
  lookOffset?: Vec3 | null

  /** Position smoothing half-life in seconds. `0` = rigid. */
  positionDamping?: number

  /** Look-at smoothing half-life in seconds. `0` = rigid. */
  lookDamping?: number
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
  lookOffset = null,
  positionDamping: initialPositionDamping = 0.12,
  lookDamping: initialLookDamping = 0.08,
  fov = 55,
  near = 0.1,
  far = 400,
}: FollowCameraOptions = {}): FollowCamera {
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far)

  const localOffset  = new THREE.Vector3(...offset)
  const localLook    = new THREE.Vector3()
  const desired      = new THREE.Vector3()
  const desiredLook  = new THREE.Vector3()
  const smoothedLook = new THREE.Vector3()
  let positionDamping = initialPositionDamping
  let lookDamping     = initialLookDamping
  let aimsLocally     = lookOffset !== null
  let initialised     = false

  if (lookOffset)
    localLook.set(...lookOffset)

  function idealPosition (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): THREE.Vector3 {
    return desired.copy(localOffset).applyQuaternion(targetQuaternion)
      .add(targetPosition)
  }

  // Two ways to aim. The default rides the world up axis, so the horizon stays
  // level however the target rolls. A local look offset instead turns with the
  // target — which is the whole point when the camera is sitting inside it.
  function idealLook (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): THREE.Vector3 {
    if (aimsLocally)
      return desiredLook.copy(localLook).applyQuaternion(targetQuaternion)
        .add(targetPosition)
    return desiredLook.copy(targetPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, lookAhead)
  }

  function snap (targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion): void {
    camera.position.copy(idealPosition(targetPosition, targetQuaternion))
    smoothedLook.copy(idealLook(targetPosition, targetQuaternion))
    camera.lookAt(smoothedLook)
    initialised = true
  }

  return {
    camera,
    snap,

    aim (station) {
      if (station.offset)
        localOffset.set(...station.offset)

      if (station.lookOffset === null)
        aimsLocally = false
      else if (station.lookOffset) {
        localLook.set(...station.lookOffset)
        aimsLocally = true
      }

      if (station.positionDamping !== undefined)
        positionDamping = station.positionDamping

      if (station.lookDamping !== undefined)
        lookDamping = station.lookDamping
    },

    update (targetPosition, targetQuaternion, delta) {
      if (!initialised)
        return snap(targetPosition, targetQuaternion)

      camera.position.lerp(idealPosition(targetPosition, targetQuaternion), smoothing(positionDamping, delta))
      smoothedLook.lerp(idealLook(targetPosition, targetQuaternion), smoothing(lookDamping, delta))
      camera.lookAt(smoothedLook)
    },
  }
}

// perf: free. Two lerps and a lookAt per frame, zero allocation.
