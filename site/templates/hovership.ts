// Third-person hovership racer (barebones)
// ----------------------------------------
// The smallest thing that still feels like a racing game: a closed procedural
// track, a ship that advances along it at a constant rate, drag-to-steer that
// goes through app state (never straight into the transform), and a damped
// chase camera. Everything scene-specific — the track shape, the ship, the
// hover bob — lives here; the camera rig is the library's.

import * as THREE from 'three'

import { createApp, defineModule, createFollowCamera, attachPointerGesture } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { postProcessing } from '@tuomashatakka/threejs-scene/modules/post'
import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { Prop, createStandardMaterial } from '@tuomashatakka/threejs-scene/modules/assets'

import type { App, AppModule, FollowCamera } from '@tuomashatakka/threejs-scene'


interface RaceState {

  /** Lateral position across the track, -1 (left kerb) .. 1 (right kerb). */
  steer: number

  /** Forward speed in track-units per second. */
  speed: number
}

const TRACK_WIDTH = 7
const SHIP_HOVER  = 0.8

/** A closed, gently banked circuit. Swap these points to redraw the track. */
function createTrackCurve (): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(40, 0, -26),
    new THREE.Vector3(72, 0, -6),
    new THREE.Vector3(60, 0, 40),
    new THREE.Vector3(16, 0, 58),
    new THREE.Vector3(-32, 0, 40),
    new THREE.Vector3(-46, 0, -4),
    new THREE.Vector3(-20, 0, -30),
  ], true, 'catmullrom', 0.5)
}

/** Sweep a flat ribbon along the curve — the drivable surface. */
function buildTrackGeometry (curve: THREE.CatmullRomCurve3, segments = 400): THREE.BufferGeometry {
  const positions         = new Float32Array((segments + 1) * 2 * 3)
  const uvs               = new Float32Array((segments + 1) * 2 * 2)
  const indices: number[] = []

  const point   = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3(0, 1, 0)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPoint(t, point)
    curve.getTangent(t, tangent)
    // perpendicular in the ground plane — the track never rolls, so a fixed up is fine
    side.crossVectors(tangent, up).normalize()
      .multiplyScalar(TRACK_WIDTH / 2)

    const base          = i * 6
    positions[base]     = point.x - side.x
    positions[base + 1] = point.y
    positions[base + 2] = point.z - side.z
    positions[base + 3] = point.x + side.x
    positions[base + 4] = point.y
    positions[base + 5] = point.z + side.z

    const uvBase    = i * 4
    uvs[uvBase]     = 0
    uvs[uvBase + 1] = t * 40
    uvs[uvBase + 2] = 1
    uvs[uvBase + 3] = t * 40

    if (i < segments) {
      const v = i * 2
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The player ship: a Prop, so one dispose() frees the whole assembly. */
function buildShip (): Prop {
  const ship = new Prop('hovership')

  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 2.4, 6),
    createStandardMaterial('metal', { color: '#d9dee8', roughness: 0.28 }),
  )
  hull.rotation.x = Math.PI / 2 // tips the cone's +y nose onto +z, the direction of travel
  hull.castShadow = true

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    createStandardMaterial('glass', { color: '#8fd8ff', thickness: 0.2 }),
  )
  canopy.position.set(0, 0.24, 0.15)

  const thruster = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.34, 0.5, 12),
    createStandardMaterial('emissive', { emissive: '#ff8a3d', emissiveIntensity: 4 }),
  )
  thruster.rotation.x = Math.PI / 2
  thruster.position.z = -1.25 // aft: the nose is +z

  const finMaterial = createStandardMaterial('plastic', { color: '#ff5d73', roughness: 0.5 })
  for (const sign of [ -1, 1 ]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.5), finMaterial)
    fin.position.set(sign * 0.62, -0.05, -0.75)
    fin.rotation.z = sign * 0.35
    fin.castShadow = true
    ship.addPart(sign < 0 ? 'finLeft' : 'finRight', fin)
  }

  return ship.addPart('hull', hull).addPart('canopy', canopy)
    .addPart('thruster', thruster)
}

function raceTrack (): AppModule<RaceState> {
  const curve = createTrackCurve()

  return defineModule<RaceState>({
    name: 'race-track',

    build (ctx) {
      const road = new THREE.Mesh(
        buildTrackGeometry(curve),
        createStandardMaterial('matte', { color: '#23262e', roughness: 0.85, side: THREE.DoubleSide }),
      )
      road.name          = 'road'
      road.receiveShadow = true
      ctx.scene.add(road)

      // kerb markers every few metres so speed is legible
      const markerGeometry = new THREE.BoxGeometry(0.35, 0.12, 1.6)
      const markerMaterial = createStandardMaterial('emissive', { emissive: '#79f7ff', emissiveIntensity: 1.5 })
      const markers        = new THREE.InstancedMesh(markerGeometry, markerMaterial, 120)
      const matrix         = new THREE.Matrix4()
      const point          = new THREE.Vector3()
      const tangent        = new THREE.Vector3()
      const side           = new THREE.Vector3()
      const up             = new THREE.Vector3(0, 1, 0)

      for (let i = 0; i < 60; i++) {
        const t = i / 60
        curve.getPoint(t, point)
        curve.getTangent(t, tangent)
        side.crossVectors(tangent, up).normalize()
          .multiplyScalar(TRACK_WIDTH / 2 + 0.3)

        const angle = Math.atan2(tangent.x, tangent.z)

        for (const [ slot, sign ] of [[ i * 2, -1 ], [ i * 2 + 1, 1 ]] as const) {
          matrix.makeRotationY(angle)
          matrix.setPosition(point.x + side.x * sign, 0.06, point.z + side.z * sign)
          markers.setMatrixAt(slot, matrix)
        }
      }
      markers.instanceMatrix.needsUpdate = true
      ctx.scene.add(markers)

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        createStandardMaterial('matte', { color: '#0e1018', roughness: 1 }),
      )
      ground.rotation.x    = -Math.PI / 2
      ground.position.y    = -0.4
      ground.receiveShadow = true
      ctx.scene.add(ground)

      ctx.scene.fog = new THREE.FogExp2('#0a0a14', 0.008)
    },
  })
}

/** Drives the ship along the curve and feeds the chase camera. */
function shipPilot (rig: FollowCamera): AppModule<RaceState> {
  const curve   = createTrackCurve()
  const length  = curve.getLength()
  const point   = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3(0, 1, 0)

  let ship: Prop | null = null
  let distance          = 0

  return defineModule<RaceState>({
    name: 'ship-pilot',

    build (ctx) {
      ship = buildShip()
      ctx.scene.add(ship)
    },

    update (state, frame) {
      if (!ship)
        return

      distance = (distance + state.speed * frame.delta) % length

      const t  = distance / length

      curve.getPoint(t, point)
      curve.getTangent(t, tangent)
      side.crossVectors(tangent, up).normalize()

      // steer offsets laterally; hover bob keeps it alive at a standstill
      const lateral = state.steer * (TRACK_WIDTH / 2 - 0.8)
      const bob     = Math.sin(frame.elapsed * 3.1) * 0.06

      ship.position.copy(point).addScaledVector(side, lateral)
      ship.position.y += SHIP_HOVER + bob

      // Set the whole orientation at once. Doing lookAt() and then assigning
      // rotation.z corrupts it: a 180° yaw is representable in Euler XYZ as
      // (π, π−θ, π), so overwriting one component silently tips the ship — and
      // the chase camera's offset rotates underground with it.
      // XYZ order applies Z innermost, so z rolls about the ship's own forward
      // axis before y yaws it onto the track heading.
      const yaw = Math.atan2(tangent.x, tangent.z)
      ship.rotation.set(0, yaw, -state.steer * 0.4)

      rig.update(ship.position, ship.quaternion, frame.delta)
    },

    dispose () {
      ship?.dispose()
      ship = null
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<RaceState> {
  const rig = createFollowCamera({ offset: [ 0, 2.6, -7.5 ], lookAhead: 1.2 })

  const app = createApp<RaceState>(canvas, {
    state:  { steer: 0, speed: 18 },
    seed:   3,
    camera: rig.camera,
    scene:  { background: '#0a0a14' },
    use:    [
      standardLighting({
        env:  { intensity: 0.45 },
        sun:  { position: [ 30, 40, 20 ], intensity: 1.6, shadowFrustum: 60 },
        hemi: { skyColor: '#9fc4ff', groundColor: '#141820', intensity: 0.35 },
      }),
      raceTrack(),
      shipPilot(rig),
      postProcessing<RaceState>({
        bloom:   false,
        effects: ctx => [ createBloom({ strength: 0.4, threshold: 0.78, width: ctx.width, height: ctx.height }) ],
      }),
    ],
  })

  // Input goes through state, never straight into the transform — the same
  // reducer-ish path a real game would use for replay/netcode.
  const detach = attachPointerGesture(canvas, {
    onDrag (dx) {
      const next = app.getState().steer + dx * 0.004
      app.setState({ steer: Math.max(-1, Math.min(1, next)) })
    },
  })

  const dispose = app.dispose
  app.dispose   = () => {
    detach()
    dispose()
  }
  return app
}

// perf: road + ground + 1 instanced kerb mesh + 4 ship meshes ≈ 8 draw calls.
