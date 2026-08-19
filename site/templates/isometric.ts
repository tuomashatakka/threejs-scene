// Isometric tilt-shift endless scape
// ----------------------------------
// An orthographic iso rig over terrain that scrolls forever, pannable and
// zoomable. The world is ONE merged, triangulated heightfield (a single
// BufferGeometry, one draw call); it never grows, because the grid of quads
// stays put and only its vertex heights are re-sampled as the view slides.
// Panning is therefore not a camera move at all — it shifts the sample origin,
// which is why the map is endless in every direction rather than just forward.
// A flat water plane fills the lowlands, with boats sailing it and low-poly
// clouds drifting overhead.
//
// Zoom is the interesting control: one number drives the frustum, the camera's
// elevation, the fog band, and the tilt-shift blur at once. Zoom in and the rig
// tilts up toward the horizon while the bokeh thickens — the miniature reads as
// a model you leaned in on. Zoom out and it lifts back into a map.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { createApp, defineModule, createIsoCamera, resizeIsoCamera, aimIsoCamera, attachPointerGesture } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { postProcessing, FULLSCREEN_VERTEX, createGradePass } from 'threejs-scene/modules/post'
import { createBloom } from 'threejs-scene/modules/post/webgl/bloom'
import { createStandardMaterial, treeProp, rockProp, boatProp, cloudProp } from 'threejs-scene/modules/assets'

import type { App, AppModule } from 'threejs-scene'
import type { Prop } from 'threejs-scene/modules/assets'
import type { Pass } from 'threejs-scene/modules/post/webgl/types'


interface ScapeState {

  /** Auto-scroll rate along the track axis, in grid cells per second. */
  speed: number

  /** View centre in grid coordinates — panning moves this, not the camera. */
  panX: number
  panZ: number

  /** 1 = default framing, >1 closer. Drives frustum, tilt, fog AND bokeh. */
  zoom: number
}

const GRID   = 64 // cells per side -> GRID² quads, merged into ONE mesh, one draw call
const CELL   = 0.96 // world units per cell
const HEIGHT = 5.2 // tallest point

// Water surface height and the basin floor the terrain is clamped to. Land is
// anything standing above SEA; a single flat water plane sits at SEA and hides
// the basin beneath it, so lowlands read as open water rather than blue ground.
const SEA   = HEIGHT * 0.3
const FLOOR = HEIGHT * 0.1

// low → high tiers, keyed off SEA so the two water colours land below the
// waterline and the ground colours above it: deep water, shallows, grass, rock, snow
const PALETTE = [ '#22405e', '#356f96', '#5f9e6a', '#8a8f7d', '#e8ebe6' ]

/** Palette tier for a raw (un-clamped) sample height. */
function colorTier (raw: number): string {
  if (raw < SEA * 0.62)
    return PALETTE[0]! // deep water
  if (raw < SEA)
    return PALETTE[1]! // shallows
  if (raw < HEIGHT * 0.56)
    return PALETTE[2]! // grass
  if (raw < HEIGHT * 0.8)
    return PALETTE[3]! // rock
  return PALETTE[4]! // snow
}

// The rig's yaw, in radians. Fixed, so the two ground-plane screen axes below
// are constants rather than per-frame matrix reads.
const YAW = Math.PI / 4
// Screen-right and screen-up projected onto the ground, for an iso camera at
// YAW looking at the origin. Derived from three's lookAt basis: screen-right is
// x = ẑ × up; screen-up is the ground component of ŷ = ẑ × x, which points
// AWAY from the camera — the negative of (cos YAW, sin YAW). Getting this sign
// wrong sent every vertical pan the wrong way while horizontal stayed correct.
const RIGHT_X = Math.sin(YAW)
const RIGHT_Z = -Math.cos(YAW)
const UP_X    = -Math.cos(YAW)
const UP_Z    = -Math.sin(YAW)

const VIEW_SIZE = 20 // vertical world span at zoom 1
const ZOOM_MIN  = 0.7 // any wider and the frame outruns the grid, showing the slab edge
const ZOOM_MAX  = 3
// Elevation in degrees at either end of the zoom range. Zoomed out is nearly
// top-down and map-like; zoomed in tips up toward the horizon.
const TILT_WIDE  = 34
const TILT_CLOSE = 19
// Tilt-shift strength/band at either end. Closer = a thicker blur over a
// narrower sharp band, which is exactly how a real tilted lens behaves. Tuned
// so zoom 1 lands on 2.6/0.18 — the fixed values this scene used before it
// could zoom at all.
const BLUR_WIDE  = 1.6
const BLUR_CLOSE = 5.8
const BAND_WIDE  = 0.22
const BAND_CLOSE = 0.1

const lerp      = (a: number, b: number, t: number): number => a + (b - a) * t
const clampZoom = (zoom: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))

/**
 * Where a zoom level sits in the range, 0 (widest) .. 1 (closest). Logarithmic
 * because zoom is multiplicative — a wheel notch should feel the same at either
 * end, and a linear fraction would spend most of its travel near ZOOM_MAX.
 */
function zoomFraction (zoom: number): number {
  return (Math.log(clampZoom(zoom)) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))
}

// Seamless value noise. Hash-based so any world coordinate can be sampled
// directly — no stored heightmap to scroll, wrap, or run out of.
function hash2 (x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function valueNoise (x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  // smoothstep the interpolants so cell edges don't crease
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)

  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)

  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

function terrainHeight (x: number, z: number): number {
  // three octaves: broad landmass, mid relief, fine detail
  const broad = valueNoise(x * 0.045, z * 0.045)
  const mid   = valueNoise(x * 0.13, z * 0.13) * 0.4
  const fine  = valueNoise(x * 0.31, z * 0.31) * 0.16
  const n     = (broad + mid + fine) / 1.56
  // gentle gamma keeps lowlands flat (they read as water) without crushing peaks
  return Math.pow(n, 1.35) * HEIGHT
}

// A second, slower noise field that has nothing to do with elevation: it decides
// which stretches of land are wooded. Low frequency so the boundaries are broad —
// the auto-scroll carries the view through a dense forest, then out into open
// plains, then back — and offset off the terrain lattice so tree cover never
// simply traces the hills. Land above the threshold reads as forest; below it,
// plains. Sampled per world coordinate, so a stand of trees stays welded to its
// patch of ground exactly like the heights do.
const FOREST_FREQ      = 0.055
const FOREST_THRESHOLD = 0.52

function forestDensity (x: number, z: number): number {
  return valueNoise(x * FOREST_FREQ + 41.7, z * FOREST_FREQ - 17.3)
}

/** A tilt-shift pass whose focus band can be racked from outside. */
interface TiltShiftPass extends Pass {
  setSize (width: number, height: number): void

  /** `strength` in blur pixels at the frame edge; `band` is the sharp fraction of screen height. */
  setBokeh (strength: number, band: number): void
}

// Tilt-shift: blur strength driven by distance from a horizontal focus band.
// Screen-space (not depth) on purpose — an ortho camera has no perspective
// falloff to key off, and the miniature illusion is a *screen* effect anyway.
function createTiltShiftPass (): TiltShiftPass {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse:    { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFocus:      { value: 0.5 },
      uBand:       { value: BAND_WIDE },
      uStrength:   { value: BLUR_WIDE },
    },
    vertexShader:   FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uFocus, uBand, uStrength;
      varying vec2 vUv;
      void main () {
        float d = abs(vUv.y - uFocus);
        float blur = smoothstep(uBand, uBand + 0.34, d) * uStrength;
        vec2 texel = blur / uResolution;

        // separable-ish 9 tap: cheap, and at these radii nobody can tell
        vec4 sum = texture2D(tDiffuse, vUv) * 0.227;
        sum += (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)) + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0))) * 0.194;
        sum += (texture2D(tDiffuse, vUv + vec2(texel.x * 2.0, 0.0)) + texture2D(tDiffuse, vUv - vec2(texel.x * 2.0, 0.0))) * 0.121;
        sum += (texture2D(tDiffuse, vUv + vec2(0.0, texel.y)) + texture2D(tDiffuse, vUv - vec2(0.0, texel.y))) * 0.194;
        sum += (texture2D(tDiffuse, vUv + vec2(0.0, texel.y * 2.0)) + texture2D(tDiffuse, vUv - vec2(0.0, texel.y * 2.0))) * 0.121;
        gl_FragColor = sum / 1.172;
      }
    `,
  }) as ShaderPass & TiltShiftPass

  pass.setSize = (width, height) => {
    (pass.uniforms.uResolution!.value as THREE.Vector2).set(width, height)
  }
  pass.setBokeh = (strength, band) => {
    pass.uniforms.uStrength!.value = strength
    pass.uniforms.uBand!.value     = band
  }
  return pass
}

/**
 * Everything zoom drives, in one module: frustum, elevation, fog depth, and the
 * tilt-shift band. Keeping them together is the point — split across three
 * modules they would drift out of agreement the first time one was retuned.
 */
function isoViewRig (tiltShift: TiltShiftPass): AppModule<ScapeState> {
  let aspect  = 1
  let applied = NaN

  function apply (camera: THREE.OrthographicCamera, scene: THREE.Scene, zoom: number): void {
    const t        = zoomFraction(zoom)
    const viewSize = VIEW_SIZE / clampZoom(zoom)

    camera.userData.viewSize = viewSize
    resizeIsoCamera(camera, aspect)
    aimIsoCamera(camera, { tilt: lerp(TILT_WIDE, TILT_CLOSE, t) })
    tiltShift.setBokeh(lerp(BLUR_WIDE, BLUR_CLOSE, t), lerp(BAND_WIDE, BAND_CLOSE, t))

    // Fog is measured from the CAMERA, which an ortho rig parks ~100 units out,
    // so the band has to track the visible span or it reads as a flat grey wash
    // the moment you zoom. These multipliers reproduce the zoom-1 look at every
    // zoom level: haze just starting at the near edge, thick at the far one.
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      const radius = camera.position.length()
      fog.near     = radius - viewSize * 0.92
      fog.far      = radius + viewSize * 1.53
    }
  }

  return defineModule<ScapeState>({
    name: 'iso-view-rig',

    build (ctx) {
      const size = ctx.renderer.getSize(new THREE.Vector2())
      aspect        = size.x / size.y || 1
      ctx.scene.fog = new THREE.Fog('#0a0a14', 1, 2) // range set by apply()
      apply(ctx.camera as THREE.OrthographicCamera, ctx.scene, 1)
    },

    update (state, _frame, ctx) {
      // zoom eases in the input layer, so this settles and then costs nothing
      if (state.zoom === applied)
        return
      applied = state.zoom
      apply(ctx.camera as THREE.OrthographicCamera, ctx.scene, state.zoom)
    },

    resize (size, ctx) {
      // the built-in resize only fixes perspective aspect — ortho needs its
      // frustum re-derived by hand
      aspect = size.width / size.height
      resizeIsoCamera(ctx.camera as THREE.OrthographicCamera, aspect)
    },
  })
}

/**
 * A prop pinned to a world coordinate so it rides the world as the view slides.
 * Trees and rocks stand on land; boats sail the water and clouds drift overhead,
 * both carrying a slow world-space velocity and a phase for their bob.
 */
interface Dressing {
  prop: Prop
  kind: 'tree' | 'rock' | 'boat' | 'cloud'
  wx:   number
  wz:   number

  /** World units per second; boats and clouds drift, trees and rocks don't. */
  vx?: number
  vz?: number

  /** Bob/roll phase so a fleet or a sky-full doesn't move in lockstep. */
  phase?: number
}

// Dressing stands on land — a little above the water plane so nothing wades in
// at the shoreline. Boats want the opposite: clearly open water, well below SEA.
const WATERLINE  = SEA + HEIGHT * 0.05
const BOAT_WATER = SEA - HEIGHT * 0.06
const CLOUD_Y    = HEIGHT * 2.6

/**
 * Fold a prop's home coordinate into the GRID-wide box around the view centre.
 * Props tile the plane instead of being recycled at one edge, so panning in any
 * direction — including backwards — always has dressing to show, with no
 * bookkeeping and nothing to run out of.
 */
function wrapAround (world: number, centre: number): number {
  return world + GRID * Math.round((centre - world) / GRID)
}

/**
 * A single flat water plane at SEA. Translucent, so the clamped basin darkens
 * the deeps into water; large enough that its far edge dissolves into the fog
 * instead of showing a seam. Static — the world scrolls past it, the water
 * doesn't move — so nothing needs to touch it after build.
 */
function makeWaterPlane (): THREE.Mesh {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID * CELL * 3.2, GRID * CELL * 3.2),
    createStandardMaterial('matte', { color: '#2f6188', roughness: 0.22, transparent: true, opacity: 0.82 }),
  )
  water.name          = 'water'
  water.rotation.x    = -Math.PI / 2
  water.position.y    = SEA
  water.frustumCulled = false
  water.renderOrder   = 1 // draw after the opaque terrain so it blends over the deeps
  return water
}

/**
 * The endless terrain: ONE merged, triangulated heightfield. It is a single
 * BufferGeometry of GRID² quads, each split into two triangles and welded into
 * one buffer — the same "collapse it all into one mesh, one draw call" idea the
 * voxel greedy-mesher uses, but as a low-poly surface of triangles rather than
 * cubes. Non-indexed and flat-shaded, so every triangle keeps its own crisp
 * facet. As the view slides, the mesh shifts by the sub-cell remainder each
 * frame and only re-samples its heights when the base cell crosses — it never
 * grows, so the map is endless in every direction. A flat water plane sits at
 * SEA: boats sail it and clouds drift above.
 */
function terrainScape (): AppModule<ScapeState> {
  const dressing: Dressing[] = []
  const SIDE                 = GRID + 1
  const rawH                 = new Float32Array(SIDE * SIDE)
  const color                = new THREE.Color()

  let geometry:  THREE.BufferGeometry | undefined
  let terrain:   THREE.Mesh | undefined
  let lastBaseX = NaN
  let lastBaseZ = NaN

  // Re-sample the world under (baseX, baseZ) and rewrite every vertex + colour.
  // Heights are sampled once on the (GRID+1)² lattice and shared between the two
  // triangles of each cell, so the surface is seamless.
  function resample (baseX: number, baseZ: number): void {
    if (!geometry)
      return

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute
    const pos     = posAttr.array as Float32Array
    const col     = colAttr.array as Float32Array

    for (let jj = 0; jj < SIDE; jj++)
      for (let ii = 0; ii < SIDE; ii++)
        rawH[jj * SIDE + ii] = terrainHeight(baseX + ii - GRID / 2, baseZ + jj - GRID / 2)

    let p = 0
    let c = 0
    const put = (x: number, y: number, z: number): void => {
      pos[p++] = x; pos[p++] = y; pos[p++] = z
      col[c++]                             = color.r; col[c++] = color.g; col[c++] = color.b
    }

    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const r00 = rawH[j * SIDE + i]!
        const r10 = rawH[j * SIDE + i + 1]!
        const r01 = rawH[(j + 1) * SIDE + i]!
        const r11 = rawH[(j + 1) * SIDE + i + 1]!
        // clamp to the basin floor so the underwater dip stays shallow and tidy
        const h00 = Math.max(r00, FLOOR)
        const h10 = Math.max(r10, FLOOR)
        const h01 = Math.max(r01, FLOOR)
        const h11 = Math.max(r11, FLOOR)

        const x0 = (i - GRID / 2) * CELL
        const x1 = (i + 1 - GRID / 2) * CELL
        const z0 = (j - GRID / 2) * CELL
        const z1 = (j + 1 - GRID / 2) * CELL

        // one flat colour per cell, from the mean of its four corner samples
        color.set(colorTier((r00 + r10 + r01 + r11) * 0.25))
        // two up-facing triangles (winding chosen so the face normals point +y)
        put(x0, h00, z0); put(x1, h11, z1); put(x1, h10, z0)
        put(x0, h00, z0); put(x0, h01, z1); put(x1, h11, z1)
      }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    // non-indexed, so this hands every triangle its own facet normal — the
    // low-poly look, with no smoothing across cell edges
    geometry.computeVertexNormals()
  }

  return defineModule<ScapeState>({
    name: 'terrain-scape',

    build (ctx) {
      // one merged buffer: GRID² quads × 2 triangles × 3 corners, unshared so
      // each facet stays crisp; positions and colours are rewritten in place
      geometry     = new THREE.BufferGeometry()

      const verts  = GRID * GRID * 6
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage))
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage))

      // vertexColors is correct HERE (unlike the old InstancedMesh) because the
      // geometry now carries a real `color` attribute for the shader to read.
      const material     = createStandardMaterial('matte', { color: '#ffffff', vertexColors: true, flatShading: true })
      terrain            = new THREE.Mesh(geometry, material)
      terrain.name          = 'terrain'
      terrain.castShadow    = true
      terrain.receiveShadow = true
      terrain.frustumCulled = false // verts move every cell-cross; skip stale-bounds culling
      ctx.scene.add(terrain)
      resample(0, 0)

      ctx.scene.add(makeWaterPlane())

      // Dressing: fixed home coordinates wrapped into view every frame, so each
      // stays welded to its patch of world however far the view pans. Boats and
      // clouds additionally carry a slow world-space drift (see update).
      const rng = ctx.rng.fork('dressing')

      // Trees carry a spread of greens and heights so a stand doesn't read as one
      // cloned conifer, and only light up over the forest field (see update).
      for (let i = 0; i < 96; i++) {
        const canopy = new THREE.Color().setHSL(0.32 + rng.range(-0.04, 0.05), 0.42, rng.range(0.28, 0.4))
        const prop   = treeProp({ rng, scale: rng.range(0.7, 1.05), canopyColor: canopy })
        dressing.push({ prop, kind: 'tree', wx: rng.range(-GRID / 2, GRID / 2), wz: rng.range(-GRID / 2, GRID / 2) })
        ctx.scene.add(prop)
      }

      // Boulders are sparser and stand anywhere on land.
      for (let i = 0; i < 22; i++) {
        const prop = rockProp({ rng, scale: rng.range(0.6, 1.0) })
        dressing.push({ prop, kind: 'rock', wx: rng.range(-GRID / 2, GRID / 2), wz: rng.range(-GRID / 2, GRID / 2) })
        ctx.scene.add(prop)
      }

      // A small fleet, each on its own heading, shown only over open water — so a
      // sail drifts past every now and then rather than a whole harbour at once.
      for (let i = 0; i < 6; i++) {
        const heading = rng.range(0, Math.PI * 2)
        const speed   = rng.range(0.4, 0.8)
        const prop    = boatProp({ rng, scale: rng.range(0.9, 1.2) })
        dressing.push({
          prop,
          kind:  'boat',
          wx:    rng.range(-GRID / 2, GRID / 2),
          wz:    rng.range(-GRID / 2, GRID / 2),
          vx:    Math.sin(heading) * speed,
          vz:    Math.cos(heading) * speed,
          phase: rng.range(0, Math.PI * 2),
        })
        ctx.scene.add(prop)
      }

      // Low-poly clouds drifting overhead, each on its own slow heading.
      for (let i = 0; i < 8; i++) {
        const heading = rng.range(0, Math.PI * 2)
        const speed   = rng.range(0.15, 0.4)
        const prop    = cloudProp({ rng, scale: rng.range(0.9, 1.7) })
        dressing.push({
          prop,
          kind:  'cloud',
          wx:    rng.range(-GRID / 2, GRID / 2),
          wz:    rng.range(-GRID / 2, GRID / 2),
          vx:    Math.sin(heading) * speed,
          vz:    Math.cos(heading) * speed,
          phase: rng.range(0, Math.PI * 2),
        })
        ctx.scene.add(prop)
      }
    },

    update (state, frame, _ctx) {
      if (!terrain)
        return

      // The view centre in grid space: the endless forward scroll plus the pan.
      const offsetX = state.panX
      const offsetZ = frame.elapsed * state.speed * 3 + state.panZ
      const baseX   = Math.floor(offsetX)
      const baseZ   = Math.floor(offsetZ)

      // Slide the whole mesh by the sub-cell remainder every frame (free), and
      // only re-sample the heightfield when we cross a cell boundary.
      terrain.position.x = -(offsetX - baseX) * CELL
      terrain.position.z = -(offsetZ - baseZ) * CELL

      // Props live in world coordinates, so their screen slot is simply
      // (world − offset). That keeps a tree welded to its hilltop instead of
      // hovering in screen space while the land moves underneath it.
      const dt = frame.delta
      for (const entry of dressing) {
        // boats and clouds sail/drift through the world on their own heading
        if (entry.vx !== undefined) {
          entry.wx += entry.vx * dt
          entry.wz += entry.vz! * dt
        }

        const wx = wrapAround(entry.wx, offsetX)
        const wz = wrapAround(entry.wz, offsetZ)
        const lx = (wx - offsetX) * CELL
        const lz = (wz - offsetZ) * CELL

        if (entry.kind === 'cloud') {
          entry.prop.visible = true
          entry.prop.position.set(lx, CLOUD_Y + Math.sin(frame.elapsed * 0.5 + entry.phase!) * 0.5, lz)
          continue
        }
        if (entry.kind === 'boat') {
          // only over clearly open water; bob and roll gently, bow pointing downwind
          entry.prop.visible    = terrainHeight(wx, wz) < BOAT_WATER
          entry.prop.rotation.y = Math.atan2(entry.vx!, entry.vz!)
          entry.prop.rotation.z = Math.sin(frame.elapsed * 1.3 + entry.phase!) * 0.07
          entry.prop.position.set(lx, SEA + Math.sin(frame.elapsed * 1.7 + entry.phase!) * 0.04, lz)
          continue
        }

        // trees and rocks stand on the land surface; trees also need forest cover
        const height       = terrainHeight(wx, wz)
        const onLand       = height >= WATERLINE
        entry.prop.visible = onLand && (entry.kind === 'rock' || forestDensity(wx, wz) >= FOREST_THRESHOLD)
        entry.prop.position.set(lx, height, lz)
      }

      if (lastBaseX === baseX && lastBaseZ === baseZ)
        return
      lastBaseX = baseX
      lastBaseZ = baseZ
      resample(baseX, baseZ)
    },

    dispose () {
      // props own what they built; free them explicitly. The terrain mesh, its
      // geometry, and the water plane are plain scene objects and go with the
      // scene-wide sweep.
      for (const entry of dressing)
        entry.prop.dispose()
      dressing.length = 0
      geometry        = undefined
      terrain         = undefined
      lastBaseX       = NaN
      lastBaseZ       = NaN
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<ScapeState> {
  const aspect = canvas.clientWidth / canvas.clientHeight || 1
  // viewSize is deliberately smaller than the grid's world span (GRID × CELL),
  // so terrain overfills the frame and the slab edge never shows. A shallow
  // tilt stretches the vertical screen axis across ~viewSize/sin(tilt) world
  // units, which is what sets ZOOM_MIN.
  const camera = createIsoCamera(aspect, { viewSize: VIEW_SIZE, flavor: 'dimetric' })
  // built here rather than inside `effects` so the view rig can rack its focus
  // band; postProcessing still owns it and disposes it
  const tiltShift = createTiltShiftPass()
  const gradePass = createGradePass({
    contrast: 1,
    vignette: 0.6,
  })

  const app = createApp<ScapeState>(canvas, {
    // Open fully zoomed in — the miniature "leaned-in" framing, tilted toward the
    // horizon with the thickest tilt-shift bokeh — rather than the wide map.
    state: { speed: 1, panX: 0, panZ: 0, zoom: ZOOM_MAX },
    seed:  11,
    camera,
    scene: { background: '#0a0a14' },
    use:   [
      standardLighting({ sun: { position: [ 12, 18, 8 ], intensity: 2.6 }}),
      isoViewRig(tiltShift),
      terrainScape(),

//       postProcessing<ScapeState>({
//         bloom:   false,
//         effects: ctx => [ gradePass, createBloom({ strength: 0, threshold: 0.98, width: ctx.width, height: ctx.height }), tiltShift ],
//       }),
    ],
  })

  // Drag pans, wheel/pinch zooms. Pan writes state directly (a drag should
  // track the pointer exactly), zoom eases toward a target below. Seeded to the
  // same fully-zoomed-in value as the initial state so nothing eases on load.
  let zoomTarget = ZOOM_MAX

  const detach = attachPointerGesture(canvas, {
    onDrag (dx, dy) {
      const { panX, panZ } = app.getState()
      // grid cells per CSS pixel, so a drag covers the same ground at any zoom
      const perPixel = (camera.userData.viewSize as number) / (canvas.clientHeight || 1) / CELL
      const tilt     = THREE.MathUtils.degToRad(camera.userData.tilt as number)
      // The ground is foreshortened by the tilt on the vertical screen axis
      // only — one pixel up covers 1/sin(tilt) times as much ground as one
      // pixel across. Without this the map slides diagonally under the pointer.
      const across = -dx * perPixel
      const along  = dy * perPixel / Math.sin(tilt)

      app.setState({
        panX: panX + across * RIGHT_X + along * UP_X,
        panZ: panZ + across * RIGHT_Z + along * UP_Z,
      })
    },

    onWheel (delta) {
      // exponential so a notch is the same proportional step at any zoom
      zoomTarget = clampZoom(zoomTarget * Math.exp(-delta * 0.0014))
    },

    onPinch (deltaScale) {
      zoomTarget = clampZoom(zoomTarget * deltaScale)
    },
  })

  const stopFrame = app.ctx.loop.onFrame(({ delta }) => {
    const { zoom } = app.getState()
    if (zoom === zoomTarget)
      return

    const eased = zoom + (zoomTarget - zoom) * (1 - Math.pow(2, -delta / 0.13))
    // snap once inside a pixel of travel, so the rig stops re-deriving forever
    app.setState({ zoom: Math.abs(zoomTarget - eased) < 1e-3 ? zoomTarget : eased })
  })

  const dispose = app.dispose
  app.dispose   = () => {
    stopFrame()
    detach()
    dispose()
  }
  return app
}

// perf: 1 draw call for the merged terrain heightfield + 1 for the water plane +
// one per visible dressing prop (off-screen and gated props hide themselves).
// Terrain vertices are rewritten only when the view crosses a cell boundary, and
// the view rig re-derives the frustum only while the zoom is still moving.
