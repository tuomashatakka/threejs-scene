// Third-person hovership racer
// ----------------------------
// A closed procedural circuit with real straights, a ship that drives itself —
// hard on the throttle down the straights, braking early for the sweepers —
// drag-to-steer that goes through app state (never straight into the
// transform), and a damped chase camera.
//
// The camera does the thing a real racing operator does: it racks focus. Under
// acceleration the focal plane runs out to the horizon; under braking it snaps
// back onto the ship, and the aperture opens through both so the bokeh swells
// exactly when the speed is changing and settles when it is not. Focal *length*
// stretches a little with speed too — the two together are most of why speed
// reads as speed rather than as texture scrolling past.

import * as THREE from 'three'

import { createApp, defineModule, createFollowCamera, attachPointerGesture } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { postProcessing } from '@tuomashatakka/threejs-scene/modules/post'
import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { createDof } from '@tuomashatakka/threejs-scene/modules/post/webgl/dof'
import { Prop, createStandardMaterial } from '@tuomashatakka/threejs-scene/modules/assets'

import type { App, AppModule, FollowCamera } from '@tuomashatakka/threejs-scene'
import type { BokehPass } from 'three/addons/postprocessing/BokehPass.js'


interface RaceState {

  /** Lateral position across the track, -1 (left kerb) .. 1 (right kerb). */
  steer: number

  /** Target speed on a straight, in track-units per second. */
  straightSpeed: number

  /** Target speed through the tightest corner on the circuit. */
  cornerSpeed: number
}

/** What the pilot publishes for other modules to read. The pilot is its only writer. */
interface Telemetry {

  /** Current forward speed, track-units per second. */
  speed: number

  /** -1 (full brake) .. 1 (full throttle) — how hard the speed is changing. */
  throttle: number
}

const TRACK_WIDTH = 7
const SHIP_HOVER  = 0.8

const ACCEL = 24 // units/s² — the straights are long enough to use all of it
const BRAKE = 42 // units/s² — brakes bite harder than the engine pushes

// How sharply a bend cuts the target speed. Above 1, gentle curvature is nearly
// free and only real corners cost time — which is what keeps the ship flat out
// for most of the lap.
const CORNER_BITE = 1.5
// How far ahead the speed profile looks, as a fraction of a lap. Only has to
// cover the longest braking zone: v²/2·BRAKE at top speed.
const BRAKE_WINDOW = 0.22

// The focal plane, in world units from the camera. The ship rides ~8 units
// ahead of it, so idle keeps the ship sharp, braking pulls focus in front of it
// and acceleration throws it out past the horizon.
const FOCUS_IDLE     = 9
const FOCUS_NEAR     = 4.5
const FOCUS_FAR      = 48
const APERTURE_BASE  = 0.0004
const APERTURE_SWING = 0.0018

const FOV_BASE = 55
const FOV_KICK = 7 // degrees added at top speed

const CURVATURE_SAMPLES = 240

/**
 * A closed circuit with genuine straights. Runs of collinear control points are
 * deliberate: Catmull-Rom draws a straight line through them, and without at
 * least three in a row every "straight" is really a slow curve the speed
 * profile would brake for.
 */
function createTrackCurve (): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-46, 0, -60), // ┐
    new THREE.Vector3(6, 0, -60), //   ├ north straight
    new THREE.Vector3(58, 0, -60), // ┘
    new THREE.Vector3(94, 0, -28), //   turn 1, fast sweeper
    new THREE.Vector3(94, 0, 12),
    new THREE.Vector3(60, 0, 46), //    turn 2, the slowest corner
    new THREE.Vector3(10, 0, 58), //  ┐ south straight
    new THREE.Vector3(-34, 0, 58), // ┘
    new THREE.Vector3(-80, 0, 30), //   turn 3
    new THREE.Vector3(-88, 0, -14),
  ], true, 'catmullrom', 0.5)
}

// One curve for the whole page: it is immutable, and building it once means the
// arc-length table (which getPointAt/getTangentAt need) is built once too.
const TRACK        = createTrackCurve()
const TRACK_LENGTH = TRACK.getLength()

/**
 * Curvature at evenly spaced points around the lap, normalised so the tightest
 * corner on this circuit is 1 and a straight is 0. Sampled by arc length, so an
 * index maps to a distance no matter how unevenly the control points are spaced.
 */
function sampleCurvature (curve: THREE.CatmullRomCurve3): Float32Array {
  const table = new Float32Array(CURVATURE_SAMPLES)
  const here  = new THREE.Vector3()
  const next  = new THREE.Vector3()
  let peak = 0

  for (let i = 0; i < CURVATURE_SAMPLES; i++) {
    curve.getTangentAt(i / CURVATURE_SAMPLES, here)
    curve.getTangentAt((i + 1) % CURVATURE_SAMPLES / CURVATURE_SAMPLES, next)
    // angle between successive tangents ≈ how hard the track turns per sample
    table[i] = Math.acos(Math.max(-1, Math.min(1, here.dot(next))))
    peak     = Math.max(peak, table[i]!)
  }

  if (peak > 0)
    for (let i = 0; i < CURVATURE_SAMPLES; i++)
      table[i] = table[i]! / peak

  return table
}

const CURVATURE = sampleCurvature(TRACK)

/**
 * The speed the ship may carry at `u` (0..1 around the lap). For every point in
 * the braking window it asks "how fast may I be going here and still be down to
 * that corner's speed on arrival?" — v² = v₀² + 2·a·s — and takes the lowest
 * answer. That is a racing line's speed profile in four lines, and it beats a
 * fixed lookahead: the braking point falls out of the physics instead of being
 * tuned, so it never chatters between brake and throttle on the approach.
 */
function targetSpeedAt (u: number, straight: number, corner: number): number {
  const start = Math.floor(u * CURVATURE_SAMPLES)
  const step  = TRACK_LENGTH / CURVATURE_SAMPLES
  const span  = Math.round(CURVATURE_SAMPLES * BRAKE_WINDOW)
  let limit = straight

  for (let i = 0; i < span; i++) {
    const bend    = CURVATURE[(start + i) % CURVATURE_SAMPLES]!
    const local   = straight - (straight - corner) * Math.pow(bend, CORNER_BITE)
    const allowed = Math.sqrt(local * local + 2 * BRAKE * i * step)
    if (allowed < limit)
      limit = allowed
  }
  return limit
}

/** Sweep a flat ribbon along the curve — the drivable surface. */
function buildTrackGeometry (curve: THREE.CatmullRomCurve3, segments = 480): THREE.BufferGeometry {
  const positions         = new Float32Array((segments + 1) * 2 * 3)
  const uvs               = new Float32Array((segments + 1) * 2 * 2)
  const indices: number[] = []

  const point   = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3(0, 1, 0)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    curve.getTangentAt(t, tangent)
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
    uvs[uvBase + 1] = t * 60
    uvs[uvBase + 2] = 1
    uvs[uvBase + 3] = t * 60

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
  return defineModule<RaceState>({
    name: 'race-track',

    build (ctx) {
      const road = new THREE.Mesh(
        buildTrackGeometry(TRACK),
        createStandardMaterial('matte', { color: '#23262e', roughness: 0.85, side: THREE.DoubleSide }),
      )
      road.name          = 'road'
      road.receiveShadow = true
      ctx.scene.add(road)

      // kerb markers every few metres so speed is legible
      const markerGeometry = new THREE.BoxGeometry(0.35, 0.12, 1.6)
      const markerMaterial = createStandardMaterial('emissive', { emissive: '#79f7ff', emissiveIntensity: 1.5 })
      const markers        = new THREE.InstancedMesh(markerGeometry, markerMaterial, 160)
      const matrix         = new THREE.Matrix4()
      const point          = new THREE.Vector3()
      const tangent        = new THREE.Vector3()
      const side           = new THREE.Vector3()
      const up             = new THREE.Vector3(0, 1, 0)

      for (let i = 0; i < 80; i++) {
        const t = i / 80
        TRACK.getPointAt(t, point)
        TRACK.getTangentAt(t, tangent)
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
        new THREE.PlaneGeometry(500, 500),
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

/**
 * Drives the ship along the curve and feeds the chase camera. Distance, speed
 * and throttle are module-local: they are simulation, not input, and the store
 * is for what the player and the page can set. They reach the rest of the app
 * through `telemetry`, which this module is the only writer of.
 */
function shipPilot (rig: FollowCamera, telemetry: Telemetry): AppModule<RaceState> {
  const point   = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3(0, 1, 0)

  let ship: Prop | null = null
  let distance          = 0
  let fov               = FOV_BASE

  return defineModule<RaceState>({
    name: 'ship-pilot',

    build (ctx) {
      ship               = buildShip()
      telemetry.speed    = 0
      telemetry.throttle = 0
      ctx.scene.add(ship)
    },

    update (state, frame) {
      if (!ship)
        return

      const target = targetSpeedAt(distance / TRACK_LENGTH, state.straightSpeed, state.cornerSpeed)

      // Approach the target at the right rate for the direction of travel, and
      // never overshoot it inside one tick — a large delta must not turn the
      // brakes into reverse thrust.
      telemetry.speed = target > telemetry.speed
        ? Math.min(target, telemetry.speed + ACCEL * frame.delta)
        : Math.max(target, telemetry.speed - BRAKE * frame.delta)

      // normalised so the focus puller sees a full swing on a real corner and
      // barely a flicker on a gentle one
      telemetry.throttle = Math.max(-1, Math.min(1, (target - telemetry.speed) / 14))

      distance = (distance + telemetry.speed * frame.delta) % TRACK_LENGTH

      // getPointAt/getTangentAt are arc-length parameterised — the plain
      // getPoint(t) would make the ship speed up and slow down with the control
      // point spacing, which is exactly the effect this scene is about.
      const u = distance / TRACK_LENGTH

      TRACK.getPointAt(u, point)
      TRACK.getTangentAt(u, tangent)
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

      // Focal length rides the speed itself rather than the throttle: a wider
      // lens at 60 units/s, back to normal in the hairpin.
      const pace   = (telemetry.speed - state.cornerSpeed) / Math.max(1, state.straightSpeed - state.cornerSpeed)
      const wanted = FOV_BASE + Math.max(0, Math.min(1, pace)) * FOV_KICK
      if (Math.abs(wanted - fov) > 0.01) {
        fov              = wanted
        rig.camera.fov   = fov
        rig.camera.updateProjectionMatrix()
      }
    },

    dispose () {
      ship?.dispose()
      ship     = null
      distance = 0
    },
  })
}

/**
 * Racks the depth-of-field focus off the pilot's telemetry. The pass itself is
 * created by postProcessing's `effects` callback during that module's build, so
 * this one reaches it through a getter rather than capturing an object that
 * does not exist yet at composition time.
 */
function focusPuller (getPass: () => BokehPass | null, telemetry: Telemetry): AppModule<RaceState> {
  let smoothed = 0

  return defineModule<RaceState>({
    name: 'focus-puller',

    build () {
      // the composer owns the pass; nothing to create here
    },

    update (_state, frame) {
      const pass = getPass()
      if (!pass)
        return

      // A focus puller turns a wheel, so the rack lags the throttle a little —
      // snapping the focal plane to the physics looks digital.
      smoothed += (telemetry.throttle - smoothed) * (1 - Math.pow(2, -frame.delta / 0.22))

      const reach        = smoothed >= 0 ? FOCUS_FAR - FOCUS_IDLE : FOCUS_IDLE - FOCUS_NEAR
      const { uniforms } = pass.materialBokeh

      uniforms.focus!.value    = FOCUS_IDLE + smoothed * reach
      uniforms.aperture!.value = APERTURE_BASE + Math.abs(smoothed) * APERTURE_SWING
    },

    resize (size) {
      // BokehPass snapshots camera.aspect in its constructor and never looks
      // again — left alone, the bokeh discs come out elliptical on any viewport
      // that is not square.
      const pass = getPass()
      if (pass)
        pass.materialBokeh.uniforms.aspect!.value = size.width / size.height
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<RaceState> {
  const rig                  = createFollowCamera({ offset: [ 0, 2.6, -7.5 ], lookAhead: 1.2, fov: FOV_BASE })
  const telemetry: Telemetry = { speed: 0, throttle: 0 }
  let bokeh: BokehPass | null = null

  const app = createApp<RaceState>(canvas, {
    state:  { steer: 0, straightSpeed: 62, cornerSpeed: 20 },
    seed:   3,
    camera: rig.camera,
    scene:  { background: '#0a0a14' },
    use:    [
      standardLighting({
        env:  { intensity: 0.45 },
        sun:  { position: [ 30, 40, 20 ], intensity: 1.6, shadowFrustum: 110 },
        hemi: { skyColor: '#9fc4ff', groundColor: '#141820', intensity: 0.35 },
      }),
      raceTrack(),
      shipPilot(rig, telemetry),
      focusPuller(() => bokeh, telemetry),
      postProcessing<RaceState>({
        bloom:   false,
        effects: ctx => {
          // DOF before bloom: blur the frame first, then let what is still
          // bright enough bloom, or the glow survives being defocused
          bokeh = createDof(ctx, { focus: FOCUS_IDLE, aperture: APERTURE_BASE, maxblur: 0.012 })
          return [ bokeh, createBloom({ strength: 0.4, threshold: 0.78, width: ctx.width, height: ctx.height }) ]
        },
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
    bokeh = null
    dispose()
  }
  return app
}

// perf: road + ground + 1 instanced kerb mesh + 4 ship meshes ≈ 8 draw calls.
// The bokeh pass re-renders the scene to a depth buffer, so it roughly doubles
// the geometry cost — cheap here, worth gating in a heavier scene.
