// Third-person hovership racer
// ----------------------------
// A closed procedural circuit with real straights, a ship that drives itself —
// hard on the throttle down the straights, braking early for the sweepers —
// drag-to-steer that goes through app state (never straight into the
// transform), and a chase camera you can ride inside.
//
// The view button moves the camera between two stations — behind the ship, and
// inside its canopy. Both are expressed in the ship's local space, so the
// transition is a lerp of two presets through rig.aim() rather than a second
// camera and a cut.
//
// The camera does the thing a real racing operator does: it racks focus. Under
// acceleration the focal plane runs out to the horizon; under braking it snaps
// back onto the ship, and the aperture opens through both so the bokeh swells
// exactly when the speed is changing and settles when it is not. Focal *length*
// stretches a little with speed too — the two together are most of why speed
// reads as speed rather than as texture scrolling past.

import * as THREE from 'three'

import { createApp, defineModule, createFollowCamera, attachPointerGesture } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { postProcessing } from 'threejs-scene/modules/post'
import { createBloom } from 'threejs-scene/modules/post/webgl/bloom'
import { createDof } from 'threejs-scene/modules/post/webgl/dof'
import { Prop, createStandardMaterial } from 'threejs-scene/modules/assets'

import ICARAS_PARTS from './icaras-parts.json'

import type { App, AppModule, FollowCamera } from 'threejs-scene'
import type { BokehPass } from 'three/addons/postprocessing/BokehPass.js'


interface RaceState {

  /** Lateral position across the track, -1 (left kerb) .. 1 (right kerb). */
  steer: number

  /** Target speed on a straight, in track-units per second. */
  straightSpeed: number

  /** Target speed through the tightest corner on the circuit. */
  cornerSpeed: number
}

/** Which camera station the player asked for, and how far the rig has travelled there. */
interface ViewState {

  /** The requested station. Toggled by the button; the pilot eases toward it. */
  cockpit: boolean

  /** 0 = chase, 1 = cockpit. Owned by the pilot. */
  blend: number
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

// The two camera stations, both in the ship's local space. Chase sits behind and
// above, looking at a point over the hull; cockpit sits inside the canopy looking
// straight down the nose. Everything between them is a lerp of these six numbers.
const CHASE_OFFSET   = [ 0, 2.2, -6 ] as const
const CHASE_LOOK     = [ 0, 1.2, 6 ] as const
const COCKPIT_OFFSET = [ 0, 0.42, -0.05 ] as const
const COCKPIT_LOOK   = [ 0, 0.42, 24 ] as const

// Chase damping is what gives the third-person rig its weight, but it is not
// free: exponential smoothing against a moving target settles a steady
// speed × half-life / ln2 BEHIND where the offset asks for. Measured here that
// was 6-9 extra units at racing speed — the offset below is set knowing it, and
// the half-life is kept short enough that the gap does not swing wildly between
// a corner and a straight. In the cockpit the same lag would trail the camera
// clean out of the hull, so that station is rigid and the blend crossfades to it.
const CHASE_DAMPING   = { position: 0.06, look: 0.08 }
const COCKPIT_DAMPING = { position: 0, look: 0.05 }

// Seconds to travel between stations. Long enough to read as a move rather than
// a cut, short enough that you are not waiting to drive.
const VIEW_TRANSITION = 0.9

// From the cockpit the lens tightens: a narrower field is what makes a helmet
// view feel enclosed, and it also stops the hull filling the frame edges.
const FOV_COCKPIT = 42

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

// The Icaras hull, as authored: five parts sharing one four-slot material list,
// addressed by geometry groups. The JSON carries positions, UVs, indices and the
// group table — no loader, no network, and the mesh is identical every run.
const ICARAS_MATERIALS = [ 'Body', 'Cockpit', 'Glass', 'Glow' ] as const

// The model is authored nose-to-+z, which is already this template's direction
// of travel — no flip. (The parts named engineL/engineR sit at +z and look like
// they should be aft; they are not. Trust the authored orientation.)
// Scale lives on an inner group rather than on the Prop itself because the pilot
// writes ship.rotation/position every frame and would fight anything set there.
const SHIP_SCALE = 1.45 // authored hull is ~1.7 long; this puts it at ~2.4

function buildIcarasGeometry (part: typeof ICARAS_PARTS.parts.hull): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2))
  geometry.setIndex(part.idx)

  // One draw group per material slot — this is what lets five meshes share four
  // materials instead of needing twenty.
  for (const group of part.groups)
    geometry.addGroup(group.start, group.count, ICARAS_MATERIALS.indexOf(group.mtl as never))

  geometry.computeVertexNormals()
  return geometry
}

/** The player ship: a Prop, so one dispose() frees the whole assembly. */
function buildShip (): Prop {
  const ship = new Prop('hovership')

  // Index order must match ICARAS_MATERIALS. The source model ships PBR maps for
  // these; here they are rebuilt from the library's own presets, which keeps the
  // starter free of binary assets and shows what modules/assets is for.
  const materials = [
    createStandardMaterial('metal', { color: '#d9dee8', roughness: 0.28 }),
    createStandardMaterial('metal', { color: '#2b303c', roughness: 0.55, metalness: 0.8 }),
    createStandardMaterial('glass', { color: '#8fd8ff', thickness: 0.2 }),
    createStandardMaterial('emissive', { emissive: '#ff8a3d', emissiveIntensity: 4 }),
  ]

  const assembly = new THREE.Group()
  assembly.scale.setScalar(SHIP_SCALE)

  const hull      = new THREE.Mesh(buildIcarasGeometry(ICARAS_PARTS.parts.hull), materials)
  hull.castShadow = true
  assembly.add(hull)

  // Nacelles and cannons hang off the hull at authored origins.
  for (const name of [ 'engineL', 'engineR', 'weaponL', 'weaponR' ] as const) {
    const part = ICARAS_PARTS.parts[name]
    const mesh = new THREE.Mesh(buildIcarasGeometry(part), materials)
    mesh.position.set(part.origin[0]!, part.origin[1]!, part.origin[2]!)
    mesh.castShadow = true
    hull.add(mesh)
  }

  // Every mesh is registered so the Prop's dispose chain reaches all five
  // geometries and all four shared materials exactly once.
  return ship.addPart('assembly', assembly)
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
function shipPilot (rig: FollowCamera, telemetry: Telemetry, view: ViewState): AppModule<RaceState> {
  const point   = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3(0, 1, 0)

  // Scratch for the camera-station lerp — reused so the toggle stays allocation-free.
  const offset = [ 0, 0, 0 ] as [number, number, number]
  const look   = [ 0, 0, 0 ] as [number, number, number]

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

      // Walk the blend toward whichever station the button last asked for, then
      // ease it. Linear in, smoothstep out: the rig leaves and arrives gently
      // while the middle of the move stays brisk.
      const wants = view.cockpit ? 1 : 0
      const step  = frame.delta / VIEW_TRANSITION
      view.blend  = wants > view.blend
        ? Math.min(wants, view.blend + step)
        : Math.max(wants, view.blend - step)

      const eased = view.blend * view.blend * (3 - 2 * view.blend)

      // Re-aiming the rig IS the transition. Both stations are expressed in the
      // ship's local space, so a lerp of the two carries the camera in through
      // the canopy along the hull rather than swinging around it in world space,
      // and the rig's own damping smooths whatever is left.
      for (let i = 0; i < 3; i++) {
        offset[i] = CHASE_OFFSET[i]! + (COCKPIT_OFFSET[i]! - CHASE_OFFSET[i]!) * eased
        look[i]   = CHASE_LOOK[i]! + (COCKPIT_LOOK[i]! - CHASE_LOOK[i]!) * eased
      }
      rig.aim({
        offset,
        lookOffset:      look,
        positionDamping: CHASE_DAMPING.position * (1 - eased) + COCKPIT_DAMPING.position * eased,
        lookDamping:     CHASE_DAMPING.look * (1 - eased) + COCKPIT_DAMPING.look * eased,
      })

      rig.update(ship.position, ship.quaternion, frame.delta)

      // Focal length rides the speed itself rather than the throttle: a wider
      // lens flat out down a straight, back to normal in the slow corners. The
      // cockpit pulls the whole range tighter — a narrow lens is most of why a
      // helmet view reads as enclosed.
      const pace   = (telemetry.speed - state.cornerSpeed) / Math.max(1, state.straightSpeed - state.cornerSpeed)
      const open   = FOV_BASE + Math.max(0, Math.min(1, pace)) * FOV_KICK
      const wanted = open + (FOV_COCKPIT - open) * eased
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

/**
 * The view toggle. The template owns its own control rather than asking the page
 * for one, so the starter is self-contained: drop `mount(canvas)` anywhere and
 * the button comes with it.
 */
function attachViewToggle (canvas: HTMLCanvasElement, view: ViewState): () => void {
  const button       = document.createElement('button')
  button.type        = 'button'
  button.className   = 'view-toggle'
  button.textContent = 'Cockpit view'
  // Bottom-LEFT on purpose: the pages that host these starters dock their side
  // panel on the trailing edge, and a control that hides under it is no control.
  button.style.cssText = [
    'position:absolute', 'left:12px', 'bottom:12px', 'z-index:2',
    'padding:8px 14px', 'border-radius:999px',
    'border:1px solid rgba(121,247,255,.45)',
    'background:rgba(10,10,20,.72)', 'color:#79f7ff',
    'font:inherit', 'font-size:13px', 'cursor:pointer',
    'backdrop-filter:blur(6px)',
  ].join(';')

  const onClick = (): void => {
    view.cockpit       = !view.cockpit
    button.textContent = view.cockpit ? 'Chase view' : 'Cockpit view'
  }
  button.addEventListener('click', onClick)

  // The canvas' own parent is the positioning context; guard for a detached
  // canvas so mount() stays safe to call before the element is in the document.
  const host = canvas.parentElement
  if (host) {
    if (getComputedStyle(host).position === 'static')
      host.style.position = 'relative'
    host.appendChild(button)
  }

  return () => {
    button.removeEventListener('click', onClick)
    button.remove()
  }
}

export function mount (canvas: HTMLCanvasElement): App<RaceState> {
  const rig = createFollowCamera({
    offset:          [ ...CHASE_OFFSET ],
    lookOffset:      [ ...CHASE_LOOK ],
    positionDamping: CHASE_DAMPING.position,
    lookDamping:     CHASE_DAMPING.look,
    fov:             FOV_BASE,
    near:            0.05, // the cockpit station sits inches from the canopy glass
  })
  const telemetry: Telemetry = { speed: 0, throttle: 0 }
  const view: ViewState      = { cockpit: false, blend: 0 }
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
      shipPilot(rig, telemetry, view),
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

  const detachToggle = attachViewToggle(canvas, view)

  const dispose = app.dispose
  app.dispose   = () => {
    detach()
    detachToggle()
    bokeh = null
    dispose()
  }
  return app
}

// perf: road + ground + 1 instanced kerb mesh + 4 ship meshes ≈ 8 draw calls.
// The bokeh pass re-renders the scene to a depth buffer, so it roughly doubles
// the geometry cost — cheap here, worth gating in a heavier scene.
