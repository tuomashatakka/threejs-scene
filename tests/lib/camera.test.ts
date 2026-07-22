import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createIsoCamera, resizeIsoCamera, aimIsoCamera, createFollowCamera } from 'Δ/index'


describe('createIsoCamera', () => {
  it('sizes the frustum from viewSize and aspect', () => {
    const camera = createIsoCamera(2, { viewSize: 20 })

    expect(camera.top).toBe(10)
    expect(camera.bottom).toBe(-10)
    expect(camera.right).toBe(20)
    expect(camera.left).toBe(-20)
  })

  it('falls back to a square frustum for a degenerate aspect', () => {
    // canvases report 0×0 before layout — NaN/0 aspect must not poison the matrix
    const camera = createIsoCamera(0, { viewSize: 10 })
    expect(camera.right).toBe(5)
    expect(Number.isFinite(camera.projectionMatrix.elements[0])).toBe(true)
  })

  it('tilts to the true-iso angle when asked', () => {
    const dimetric = createIsoCamera(1, { flavor: 'dimetric' })
    const trueIso  = createIsoCamera(1, { flavor: 'true-iso' })

    // true iso sits higher relative to its horizontal distance than dimetric
    const ratio = (camera: THREE.OrthographicCamera) =>
      camera.position.y / Math.hypot(camera.position.x, camera.position.z)

    expect(ratio(trueIso)).toBeGreaterThan(ratio(dimetric))
  })

  it('re-derives the frustum on resize, honouring an updated viewSize', () => {
    const camera             = createIsoCamera(1, { viewSize: 20 })
    camera.userData.viewSize = 10
    resizeIsoCamera(camera, 3)

    expect(camera.top).toBe(5)
    expect(camera.right).toBe(15)
  })
})

describe('aimIsoCamera', () => {
  it('swings the elevation while keeping the distance to the target', () => {
    const camera = createIsoCamera(1)
    const radius = camera.position.length()

    aimIsoCamera(camera, { tilt: 15 })

    expect(camera.position.length()).toBeCloseTo(radius)
    expect(camera.position.y).toBeCloseTo(radius * Math.sin(THREE.MathUtils.degToRad(15)))
  })

  it('keeps the pose fields it was not given', () => {
    const camera = createIsoCamera(1, { rotation: 20, target: [ 3, 0, -4 ]})

    aimIsoCamera(camera, { tilt: 45 })

    // yaw and target survive a tilt-only aim — this is what lets a zoom handler
    // rack the elevation without knowing the rest of the rig's setup
    expect(camera.userData.rotation).toBe(20)
    expect(camera.userData.target).toEqual([ 3, 0, -4 ])
    expect(Math.atan2(camera.position.z + 4, camera.position.x - 3))
      .toBeCloseTo(THREE.MathUtils.degToRad(20))
  })

  it('leaves the frustum alone — zoom is resizeIsoCamera s job', () => {
    const camera = createIsoCamera(2, { viewSize: 20 })

    aimIsoCamera(camera, { tilt: 10 })

    expect(camera.top).toBe(10)
    expect(camera.right).toBe(20)
  })
})

describe('createFollowCamera', () => {
  const at            = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const facingForward = () => new THREE.Quaternion()

  it('snaps to the ideal pose on the first update', () => {
    const rig = createFollowCamera({ offset: [ 0, 2, -6 ]})
    rig.update(at(0, 0, 0), facingForward(), 1 / 60)

    // offset is in the target's local space; identity rotation keeps it as-is
    expect(rig.camera.position.x).toBeCloseTo(0)
    expect(rig.camera.position.y).toBeCloseTo(2)
    expect(rig.camera.position.z).toBeCloseTo(-6)
  })

  it('applies the offset in the target local space, so it banks with the target', () => {
    const rig    = createFollowCamera({ offset: [ 0, 0, -6 ]})
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    rig.snap(at(0, 0, 0), turned)

    // yawed 90°, the "behind" offset now points along -x
    expect(rig.camera.position.x).toBeCloseTo(-6)
    expect(rig.camera.position.z).toBeCloseTo(0)
  })

  it('eases toward a moved target rather than teleporting', () => {
    const rig = createFollowCamera({ offset: [ 0, 0, -6 ], positionDamping: 0.2 })
    rig.snap(at(0, 0, 0), facingForward())

    rig.update(at(0, 0, 100), facingForward(), 1 / 60)

    const z = rig.camera.position.z

    // moved toward the new ideal (94) but nowhere near arrived
    expect(z).toBeGreaterThan(-6)
    expect(z).toBeLessThan(20)
  })

  it('converges on the target pose over many frames', () => {
    const rig = createFollowCamera({ offset: [ 0, 0, -6 ], positionDamping: 0.1 })
    rig.snap(at(0, 0, 0), facingForward())

    for (let i = 0; i < 300; i++)
      rig.update(at(0, 0, 100), facingForward(), 1 / 60)

    expect(rig.camera.position.z).toBeCloseTo(94, 1)
  })

  it('aims at a local look offset, so the look point turns with the target', () => {
    const rig    = createFollowCamera({ offset: [ 0, 0, -6 ], lookOffset: [ 0, 0, 10 ]})
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    rig.snap(at(0, 0, 0), turned)

    // yawed 90°, "10 ahead" is +x — the camera must face that way, not down -z
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion)
    expect(forward.x).toBeCloseTo(1)
    expect(forward.z).toBeCloseTo(0)
  })

  it('re-aims to a new station without rebuilding the rig', () => {
    const rig = createFollowCamera({ offset: [ 0, 2, -6 ]})
    rig.snap(at(0, 0, 0), facingForward())

    rig.aim({ offset: [ 0, 0.5, 1 ], positionDamping: 0 })
    rig.update(at(0, 0, 0), facingForward(), 1 / 60)

    // zero damping means the new station is reached in one frame
    expect(rig.camera.position.y).toBeCloseTo(0.5)
    expect(rig.camera.position.z).toBeCloseTo(1)
  })

  it('keeps a station field it was not given', () => {
    const rig = createFollowCamera({ offset: [ 0, 2, -6 ], positionDamping: 0 })
    rig.snap(at(0, 0, 0), facingForward())

    rig.aim({ positionDamping: 0 }) // offset untouched
    rig.update(at(0, 0, 0), facingForward(), 1 / 60)

    expect(rig.camera.position.y).toBeCloseTo(2)
    expect(rig.camera.position.z).toBeCloseTo(-6)
  })

  it('restores lookAhead aiming when the look offset is cleared', () => {
    const rig = createFollowCamera({ offset: [ 0, 0, -6 ], lookOffset: [ 0, 0, 10 ], lookAhead: 3 })
    rig.snap(at(0, 0, 0), facingForward())

    rig.aim({ lookOffset: null })
    rig.snap(at(0, 0, 0), facingForward())

    // back to looking at target + worldUp*3, which from -6z tilts the camera up
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion)
    expect(forward.y).toBeGreaterThan(0)
  })
})
