// Isometric tilt-shift endless scape
// ----------------------------------
// An orthographic iso rig over terrain that scrolls forever. The world is ONE
// InstancedMesh of 4,096 columns (one draw call); it never grows, because the
// grid stays put in instance space and only its heights are re-sampled as the
// view slides forward. A tilt-shift pass blurs the top and bottom bands, which
// is what sells the "tiny model railway" read.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { createApp, defineModule, createIsoCamera, resizeIsoCamera } from '@tuomashatakka/threejs-scene'
import { standardLighting } from '@tuomashatakka/threejs-scene/modules/lighting'
import { postProcessing, FULLSCREEN_VERTEX } from '@tuomashatakka/threejs-scene/modules/post'
import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { createStandardMaterial, treeProp, rockProp } from '@tuomashatakka/threejs-scene/modules/assets'

import type { App, AppModule, SeededRng } from '@tuomashatakka/threejs-scene'
import type { Prop } from '@tuomashatakka/threejs-scene/modules/assets'
import type { Pass } from '@tuomashatakka/threejs-scene/modules/post/webgl/types'


interface ScapeState {
  speed: number
}

const GRID   = 64 // columns per side -> GRID² instances, still one draw call
const CELL   = 0.96 // world units per column
const HEIGHT = 5.2 // tallest column
// low → high: deep water, shallows, grass, rock, snow
const PALETTE   = [ '#24405e', '#3f7fa6', '#5f9e6a', '#8a8f7d', '#e8ebe6' ]

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

// Tilt-shift: blur strength driven by distance from a horizontal focus band.
// Screen-space (not depth) on purpose — an ortho camera has no perspective
// falloff to key off, and the miniature illusion is a *screen* effect anyway.
function createTiltShiftPass (): Pass & { setSize (w: number, h: number): void } {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse:    { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFocus:      { value: 0.5 },
      uBand:       { value: 0.18 },
      uStrength:   { value: 2.6 },
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
  }) as ShaderPass & { setSize (w: number, h: number): void }

  pass.setSize = (width, height) => {
    (pass.uniforms.uResolution!.value as THREE.Vector2).set(width, height)
  }
  return pass
}

/**
 * A scattered prop pinned to a world (noise) coordinate rather than to the
 * screen, so it rides the land as the view scrolls past it.
 */
interface Dressing {
  prop: Prop
  wx:   number
  wz:   number
}

const WATERLINE = HEIGHT * 0.24

/** Find a land coordinate for a prop, or report that this column is underwater. */
function placeOnLand (dressing: Dressing, rng: SeededRng, wz: number): void {
  // a handful of tries beats an unbounded loop — the map is ~40% water, so six
  // samples find land almost always, and the rare miss just hides for one lap
  for (let attempt = 0; attempt < 6; attempt++) {
    const wx = rng.range(-GRID * 0.32, GRID * 0.32)
    if (terrainHeight(wx, wz) >= WATERLINE) {
      dressing.wx           = wx
      dressing.wz           = wz
      dressing.prop.visible = true
      return
    }
  }
  dressing.wz           = wz
  dressing.prop.visible = false
}

/** The endless terrain: one InstancedMesh, re-sampled as the world slides by. */
function terrainScape (): AppModule<ScapeState> {
  const dressing: Dressing[] = []
  let scatterRng: SeededRng | null = null

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

      // Scatter props so the scale reads. Each is pinned to a world coordinate
      // and repositioned every frame, so it stays planted on its own patch of
      // land as the view scrolls past — then recycles to the far edge on exit.
      const rng = ctx.rng.fork('dressing')
      for (let i = 0; i < 22; i++) {
        const prop  = i % 4 === 0 ? rockProp({ rng, scale: 0.8 }) : treeProp({ rng, scale: 0.85 })
        const entry = { prop, wx: 0, wz: 0 }
        // spread the first batch across the whole visible depth
        placeOnLand(entry, rng, rng.range(-GRID / 2, GRID / 2))
        dressing.push(entry)
        ctx.scene.add(prop)
      }
      scatterRng = rng

      // Fog distance is measured from the CAMERA, and an ortho iso rig parks
      // ~100 units out — a range expressed in terrain-units would swallow the
      // whole scene. Anchor it to the rig's actual distance instead.
      const distance = ctx.camera.position.length()
      ctx.scene.fog  = new THREE.Fog('#0a0a14', distance - GRID * CELL * 0.3, distance + GRID * CELL * 0.5)
    },

    update (state, frame, ctx) {
      const mesh = ctx.scene.getObjectByName('terrain') as THREE.InstancedMesh | undefined
      if (!mesh)
        return

      const offset = frame.elapsed * state.speed * 3
      const baseZ  = Math.floor(offset)

      // Slide the whole mesh by the sub-cell remainder every frame (free), and
      // only rewrite the 4,096 instance matrices when we cross a cell boundary.
      mesh.position.z = -(offset - baseZ) * CELL

      // Props live in world coordinates, so their screen slot is simply
      // (world − offset). That keeps a tree welded to its hilltop instead of
      // hovering in screen space while the land moves underneath it.
      for (const entry of dressing) {
        const slotZ = entry.wz - offset
        if (slotZ < -GRID / 2 && scatterRng)
          // exited past the near edge — recycle a full grid ahead
          placeOnLand(entry, scatterRng, entry.wz + GRID)

        entry.prop.position.set(
          entry.wx * CELL,
          terrainHeight(entry.wx, entry.wz),
          (entry.wz - offset) * CELL,
        )
      }

      const previous = mesh.userData.baseZ as number | undefined
      if (previous === baseZ)
        return
      mesh.userData.baseZ = baseZ

      const matrix = new THREE.Matrix4()
      const color  = new THREE.Color()
      let index  = 0

      for (let j = 0; j < GRID; j++)
        for (let i = 0; i < GRID; i++) {
          // The grid SLOT is fixed; only the sample coordinate scrolls. Putting
          // baseZ into the position instead would translate the whole slab away
          // from a fixed camera — endless in principle, off-screen in seconds.
          const worldX = i - GRID / 2
          const slotZ  = j - GRID / 2
          const worldZ = baseZ + slotZ
          // flatten everything below the waterline into one flat sheet, so the
          // lowlands read as water rather than as very short columns
          const raw    = terrainHeight(worldX, worldZ)
          const height = Math.max(raw, HEIGHT * 0.18)

          matrix.makeScale(1, height, 1)
          matrix.setPosition(worldX * CELL, height / 2, slotZ * CELL)
          mesh.setMatrixAt(index, matrix)

          const tier = Math.min(PALETTE.length - 1, Math.floor(raw / HEIGHT * PALETTE.length))
          mesh.setColorAt(index, color.set(PALETTE[tier]!))
          index++
        }

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor)
        mesh.instanceColor.needsUpdate = true
    },

    resize (size, ctx) {
      // the built-in resize only fixes perspective aspect — ortho needs its
      // frustum re-derived by hand
      resizeIsoCamera(ctx.camera as THREE.OrthographicCamera, size.width / size.height)
    },

    dispose () {
      // each Prop owns what it built; free them explicitly rather than relying
      // on the scene-wide sweep
      for (const entry of dressing)
        entry.prop.dispose()
      dressing.length = 0
      scatterRng      = null
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<ScapeState> {
  const aspect = canvas.clientWidth / canvas.clientHeight || 1
  // viewSize is deliberately smaller than the grid's world span (GRID × CELL),
  // so terrain overfills the frame and the slab edge never shows
  // A 30° tilt stretches the vertical screen axis across ~2× that distance in
  // world space, so viewSize must stay well under the grid's span (GRID × CELL)
  // for terrain to overfill the frame and hide the slab edge.
  const camera = createIsoCamera(aspect, { viewSize: 20, flavor: 'dimetric' })

  return createApp<ScapeState>(canvas, {
    state: { speed: 1 },
    seed:  11,
    camera,
    scene: { background: '#0a0a14' },
    use:   [
      standardLighting({ sun: { position: [ 12, 18, 8 ], intensity: 2.6 }}),
      terrainScape(),
      postProcessing<ScapeState>({
        bloom:   false,
        effects: ctx => [ createBloom({ strength: 0.35, threshold: 0.7, width: ctx.width, height: ctx.height }), createTiltShiftPass() ],
      }),
    ],
  })
}

// perf: 1 draw call for the terrain (InstancedMesh) + one per dressing prop.
// Instance matrices are rewritten only when the view crosses a cell boundary.
