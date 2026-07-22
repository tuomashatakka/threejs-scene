// Isometric tilt-shift endless scape
// ----------------------------------
// An orthographic iso rig over terrain that scrolls forever, pannable and
// zoomable. The world is ONE InstancedMesh of 4,096 columns (one draw call); it
// never grows, because the grid stays put in instance space and only its
// heights are re-sampled as the view slides. Panning is therefore not a camera
// move at all — it shifts the sample origin, which is why the map is endless in
// every direction rather than just forward.
//
// Zoom is the interesting control: one number drives the frustum, the camera's
// elevation, the fog band, and the tilt-shift blur at once. Zoom in and the rig
// tilts up toward the horizon while the bokeh thickens — the miniature reads as
// a model you leaned in on. Zoom out and it lifts back into a map.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { createApp, defineModule, createIsoCamera, resizeIsoCamera, aimIsoCamera, attachPointerGesture } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { postProcessing, FULLSCREEN_VERTEX } from '@tuomashatakka/threejs-scene/modules/post'
import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { createStandardMaterial, treeProp, rockProp } from '@tuomashatakka/threejs-scene/modules/assets'

import type { App, AppModule } from '@tuomashatakka/threejs-scene'
import type { Prop } from '@tuomashatakka/threejs-scene/modules/assets'
import type { Pass } from '@tuomashatakka/threejs-scene/modules/post/webgl/types'


interface ScapeState {

  /** Auto-scroll rate along the track axis, in grid cells per second. */
  speed: number

  /** View centre in grid coordinates — panning moves this, not the camera. */
  panX: number
  panZ: number

  /** 1 = default framing, >1 closer. Drives frustum, tilt, fog AND bokeh. */
  zoom: number
}

const GRID   = 64 // columns per side -> GRID² instances, still one draw call
const CELL   = 0.96 // world units per column
const HEIGHT = 5.2 // tallest column
// low → high: deep water, shallows, grass, rock, snow
const PALETTE   = [ '#24405e', '#3f7fa6', '#5f9e6a', '#8a8f7d', '#e8ebe6' ]

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

/** A scattered prop pinned to a world (noise) coordinate, so it rides the land. */
interface Dressing {
  prop: Prop

  /** Trees only appear where the forest field is high; rocks stand anywhere on land. */
  kind: 'tree' | 'rock'
  wx:   number
  wz:   number
}

// Match the grass tier boundary (raw / HEIGHT ≥ 0.4): the two lowest palette
// tiers are painted as water, so dressing may only stand at 0.4 and above or a
// tree ends up planted mid-lake.
const WATERLINE = HEIGHT * 0.4

/**
 * Fold a prop's home coordinate into the GRID-wide box around the view centre.
 * Props tile the plane instead of being recycled at one edge, so panning in any
 * direction — including backwards — always has dressing to show, with no
 * bookkeeping and nothing to run out of.
 */
function wrapAround (world: number, centre: number): number {
  return world + GRID * Math.round((centre - world) / GRID)
}

/** The endless terrain: one InstancedMesh, re-sampled as the world slides by. */
function terrainScape (): AppModule<ScapeState> {
  const dressing: Dressing[] = []
  let lastBaseX = NaN
  let lastBaseZ = NaN

  return defineModule<ScapeState>({
    name: 'terrain-scape',

    build (ctx) {
      const geometry = new THREE.BoxGeometry(CELL, 1, CELL)
      // White base so per-instance colours come through at full saturation (the
      // material colour multiplies the instance colour). Deliberately NOT
      // `vertexColors: true` — that defines USE_COLOR, and the shader then
      // multiplies by a `color` geometry attribute BoxGeometry doesn't have,
      // which reads as black. setColorAt alone drives USE_INSTANCING_COLOR.
      const material = createStandardMaterial('matte', { color: '#ffffff', flatShading: true })
      const mesh     = new THREE.InstancedMesh(geometry, material, GRID * GRID)

      mesh.name          = 'terrain'
      mesh.castShadow    = true
      mesh.receiveShadow = true
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      ctx.scene.add(mesh)

      // Scatter props so the scale reads. Each keeps a fixed home coordinate and
      // is wrapped into view every frame, so it stays planted on its own patch
      // of land however far the view pans. A wrapped prop that lands in water —
      // or, for a tree, on open plains — hides itself, so both counts run high
      // to keep a wooded stretch looking properly dense once the misses fall out.
      const rng = ctx.rng.fork('dressing')

      // Trees carry a spread of greens and heights so a stand doesn't read as
      // one cloned conifer, and only light up over the forest field (see update).
      for (let i = 0; i < 96; i++) {
        const canopy = new THREE.Color().setHSL(0.32 + rng.range(-0.04, 0.05), 0.42, rng.range(0.28, 0.4))
        const prop   = treeProp({ rng, scale: rng.range(0.7, 1.05), canopyColor: canopy })
        dressing.push({ prop, kind: 'tree', wx: rng.range(-GRID / 2, GRID / 2), wz: rng.range(-GRID / 2, GRID / 2) })
        ctx.scene.add(prop)
      }

      // Boulders are sparser and stand anywhere on land, so the plains between
      // the forests aren't bare.
      for (let i = 0; i < 22; i++) {
        const prop = rockProp({ rng, scale: rng.range(0.6, 1.0) })
        dressing.push({ prop, kind: 'rock', wx: rng.range(-GRID / 2, GRID / 2), wz: rng.range(-GRID / 2, GRID / 2) })
        ctx.scene.add(prop)
      }
    },

    update (state, frame, ctx) {
      const mesh = ctx.scene.getObjectByName('terrain') as THREE.InstancedMesh | undefined
      if (!mesh)
        return

      // The view centre in grid space: the endless forward scroll plus the pan.
      const offsetX = state.panX
      const offsetZ = frame.elapsed * state.speed * 3 + state.panZ
      const baseX   = Math.floor(offsetX)
      const baseZ   = Math.floor(offsetZ)

      // Slide the whole mesh by the sub-cell remainder every frame (free), and
      // only rewrite the 4,096 instance matrices when we cross a cell boundary.
      mesh.position.x = -(offsetX - baseX) * CELL
      mesh.position.z = -(offsetZ - baseZ) * CELL

      // Props live in world coordinates, so their screen slot is simply
      // (world − offset). That keeps a tree welded to its hilltop instead of
      // hovering in screen space while the land moves underneath it.
      for (const entry of dressing) {
        const wx     = wrapAround(entry.wx, offsetX)
        const wz     = wrapAround(entry.wz, offsetZ)
        const height = terrainHeight(wx, wz)

        // On land at all, and — for trees — only where this patch is wooded, so
        // forests bunch up and the plains between them stay open.
        const onLand       = height >= WATERLINE
        entry.prop.visible = onLand && (entry.kind === 'rock' || forestDensity(wx, wz) >= FOREST_THRESHOLD)
        entry.prop.position.set((wx - offsetX) * CELL, height, (wz - offsetZ) * CELL)
      }

      if (lastBaseX === baseX && lastBaseZ === baseZ)
        return
      lastBaseX = baseX
      lastBaseZ = baseZ

      const matrix = new THREE.Matrix4()
      const color  = new THREE.Color()
      let index  = 0

      for (let j = 0; j < GRID; j++)
        for (let i = 0; i < GRID; i++) {
          // The grid SLOT is fixed; only the sample coordinate scrolls. Putting
          // the base offset into the position instead would translate the whole
          // slab away from a fixed camera — endless in principle, off-screen in
          // seconds.
          const slotX  = i - GRID / 2
          const slotZ  = j - GRID / 2
          const worldX = baseX + slotX
          const worldZ = baseZ + slotZ
          // flatten everything below the waterline into one flat sheet, so the
          // lowlands read as water rather than as very short columns
          const raw    = terrainHeight(worldX, worldZ)
          const height = Math.max(raw, HEIGHT * 0.18)

          matrix.makeScale(1, height, 1)
          matrix.setPosition(slotX * CELL, height / 2, slotZ * CELL)
          mesh.setMatrixAt(index, matrix)

          const tier = Math.min(PALETTE.length - 1, Math.floor(raw / HEIGHT * PALETTE.length))
          mesh.setColorAt(index, color.set(PALETTE[tier]!))
          index++
        }

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor)
        mesh.instanceColor.needsUpdate = true
    },

    dispose () {
      // each Prop owns what it built; free them explicitly rather than relying
      // on the scene-wide sweep
      for (const entry of dressing)
        entry.prop.dispose()
      dressing.length = 0
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
      postProcessing<ScapeState>({
        bloom:   false,
        effects: ctx => [ createBloom({ strength: 0.35, threshold: 0.7, width: ctx.width, height: ctx.height }), tiltShift ],
      }),
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

// perf: 1 draw call for the terrain (InstancedMesh) + one per dressing prop.
// Instance matrices are rewritten only when the view crosses a cell boundary,
// and the view rig re-derives the frustum only while the zoom is still moving.
