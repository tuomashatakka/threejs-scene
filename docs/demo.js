// demo.js — parametrized WebGL post-processing playground.
//
// Loads three r184 from a CDN via the importmap in demo.html, then imports the
// REAL ported effect factories from ./post (vendored build of modules/post —
// self-contained: they only import three + three/addons). It builds one
// EffectComposer and adds every effect as a toggleable pass; each effect is
// described once in EFFECTS and the control panel is generated from that.
//
// Effect construction is guarded: a factory that throws degrades to a disabled
// control row, so one unsupported effect never blanks the whole demo.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { createComposer } from './post/composer.js'
import { createChromaticAberration } from './post/webgl/ca.js'
import { createGradePass } from './post/grade-pass.js'
import { createFilmGrainPass } from './post/film-grain-pass.js'
import { createGodRaysPass } from './post/god-rays-pass.js'
import { createRgbShiftPass, createBlockDisplacementPass, createScanCorruptionPass } from './post/glitch-passes.js'
import { createAnamorphic } from './post/webgl/anamorphic.js'
import { createCrtPass } from './post/webgl/crt.js'
import { createRetroPass } from './post/webgl/retro.js'
import { createLensingPass } from './post/webgl/lensing.js'
import { createAfterimage } from './post/webgl/afterimage.js'
import { createSobel } from './post/webgl/sobel.js'
import { createRadialBlur } from './post/webgl/radial-blur.js'
import { createDof } from './post/webgl/dof.js'
import { createMotionBlur } from './post/webgl/motion-blur.js'
import { createFXAA } from './post/webgl/fxaa.js'
import { createSMAA } from './post/webgl/smaa.js'
import { createSsaa } from './post/webgl/ssaa.js'
import { createTraa } from './post/webgl/traa.js'
import { createAo } from './post/webgl/ao.js'
import { createOutline } from './post/webgl/outline.js'
import { createSsr } from './post/webgl/ssr.js'
import { createPixel } from './post/webgl/pixel.js'
import { createBurnInPass } from './post/webgl/burn-in.js'
import { createLUT } from './post/webgl/lut.js'
import { createCinematicLUT } from './post/cinematic-lut.js'
import { createLensflare } from './post/webgl/lensflare.js'

// —————————————————————————— scene scaffolding ——————————————————————————

const canvas   = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
// no renderer.toneMapping — the composer's OutputPass tone-maps once, last.

const scene = new THREE.Scene()
scene.background = new THREE.Color('#0a0a14')

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(0, 3, 9)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.minDistance   = 3
controls.maxDistance   = 30

// lights
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x14121a, 0.6))
const sun = new THREE.DirectionalLight(0xfff2cc, 2.4)
sun.position.set(6, 8, -4)
scene.add(sun)

// a bright sun sprite the god-rays / lensflare track (world-positioned)
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.9, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
)
sunMesh.position.copy(sun.position)
scene.add(sunMesh)

// sculpture: a rotating cluster; some pieces emissive (for bloom), two "marked"
// for the outline effect.
const sculpture = new THREE.Group()
scene.add(sculpture)

const marked = []
const palette = [ 0x6ea8ff, 0xff7ab8, 0x8affc1, 0xffd27a ]
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1.6, 0.5, 220, 32),
  new THREE.MeshStandardMaterial({ color: 0x9fb2ff, metalness: 0.6, roughness: 0.25, emissive: 0x1b2a6b, emissiveIntensity: 1.2 }),
)
sculpture.add(knot)
marked.push(knot)

for (let i = 0; i < 6; i++) {
  const geo = i % 2 ? new THREE.IcosahedronGeometry(0.55, 0) : new THREE.OctahedronGeometry(0.6, 0)
  const emissive = i % 3 === 0
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color:             palette[i % palette.length],
    metalness:         0.3,
    roughness:         0.4,
    emissive:          emissive ? palette[i % palette.length] : 0x000000,
    emissiveIntensity: emissive ? 2.2 : 0,
  }))
  const a = (i / 6) * Math.PI * 2
  mesh.position.set(Math.cos(a) * 3.2, Math.sin(a * 1.3) * 1.4, Math.sin(a) * 3.2)
  sculpture.add(mesh)
  if (i === 0) marked.push(mesh)
}

// reflective-ish ground (gives SSR / reflections something to work with)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x0e1018, metalness: 0.9, roughness: 0.35 }),
)
ground.rotation.x = -Math.PI / 2
ground.position.y = -2.4
scene.add(ground)

// —————————————————————————— composer ——————————————————————————

const W = window.innerWidth
const H = window.innerHeight
const handle = createComposer({
  renderer, scene, camera, width: W, height: H,
  withDepth: true, withBloom: true,
})
const composer = handle.composer
handle.bloom.enabled = true // on by default for a good first impression

const passCtx = { renderer, scene, camera, width: W, height: H }
const tmpVec  = new THREE.Vector3()

// a soft radial sprite reused by the lens-flare ghosts
function flareTexture () {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,240,200,0.7)')
  grad.addColorStop(1, 'rgba(255,240,200,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

// —————————————————————————— effect registry ——————————————————————————
// Each entry: { id, label, group, builtin?, note?, make(), params[], frame?, resize? }
// make() returns a record `fx` with optional { pass, attach, detach }.
// params[].apply(fx, value), frame(fx, t), resize(fx, w, h) all receive that record.

const P = (key, label, min, max, step, value, apply) => ({ key, label, min, max, step, value, apply })
const uni = (pass, name) => pass.uniforms[name] // { value }

const EFFECTS = [
  // — Bloom & light —
  { id: 'bloom', label: 'Bloom', group: 'Bloom & light', builtin: true, enabled: true,
    make: () => ({ pass: handle.bloom }),
    params: [
      P('strength', 'strength', 0, 3, 0.01, 0.7, (fx, v) => { fx.pass.strength = v }),
      P('radius', 'radius', 0, 1, 0.01, 0.4, (fx, v) => { fx.pass.radius = v }),
      P('threshold', 'threshold', 0, 1, 0.01, 0.85, (fx, v) => { fx.pass.threshold = v }),
    ] },

  { id: 'godrays', label: 'God rays', group: 'Bloom & light',
    make: () => ({ pass: createGodRaysPass() }),
    params: [
      P('exposure', 'exposure', 0, 1, 0.01, 0.25, (fx, v) => { uni(fx.pass, 'uExposure').value = v }),
      P('decay', 'decay', 0.8, 1, 0.001, 0.95, (fx, v) => { uni(fx.pass, 'uDecay').value = v }),
      P('density', 'density', 0, 1.5, 0.01, 0.9, (fx, v) => { uni(fx.pass, 'uDensity').value = v }),
      P('weight', 'weight', 0, 1, 0.01, 0.4, (fx, v) => { uni(fx.pass, 'uWeight').value = v }),
      P('samples', 'samples', 8, 100, 1, 60, (fx, v) => { uni(fx.pass, 'uSamples').value = v }),
    ],
    frame: (fx) => fx.pass.updateFromLight(sunMesh.getWorldPosition(tmpVec), camera) },

  { id: 'lensflare', label: 'Lens flare (scene object)', group: 'Bloom & light',
    make: () => {
      const tex = flareTexture()
      const flare = createLensflare({ elements: [
        { texture: tex, size: 260, distance: 0 },
        { texture: tex, size: 60, distance: 0.6 },
        { texture: tex, size: 90, distance: 0.9 },
      ] })
      return { attach: () => sunMesh.add(flare), detach: () => sunMesh.remove(flare) }
    },
    params: [] },

  // — Colour & grade —
  { id: 'grade', label: 'Colour grade', group: 'Colour & grade',
    make: () => ({ pass: createGradePass({}) }),
    params: [
      P('contrast', 'contrast', 0.5, 2, 0.01, 1.05, (fx, v) => { uni(fx.pass, 'uContrast').value = v }),
      P('saturation', 'saturation', 0, 2, 0.01, 1.1, (fx, v) => { uni(fx.pass, 'uSaturation').value = v }),
      P('vignette', 'vignette', 0, 1, 0.01, 0.35, (fx, v) => { uni(fx.pass, 'uVignette').value = v }),
      P('grain', 'grain', 0, 0.2, 0.005, 0.04, (fx, v) => { uni(fx.pass, 'uGrain').value = v }),
      P('chromatic', 'chromatic', 0, 2, 0.01, 0.6, (fx, v) => { uni(fx.pass, 'uChromatic').value = v }),
    ],
    frame: (fx, t) => fx.pass.setTime(t.elapsed) },

  { id: 'lut', label: 'Cinematic LUT', group: 'Colour & grade',
    make: () => {
      const pass = createLUT({ lut: createCinematicLUT(), intensity: 1 })
      return { pass }
    },
    params: [ P('intensity', 'intensity', 0, 1, 0.01, 1, (fx, v) => { fx.pass.intensity = v }) ] },

  { id: 'filmgrain', label: 'Film grain', group: 'Colour & grade',
    make: () => ({ pass: createFilmGrainPass({}) }),
    params: [
      P('intensity', 'intensity', 0, 0.4, 0.005, 0.08, (fx, v) => { uni(fx.pass, 'uIntensity').value = v }),
      P('luma', 'luma', 0, 1, 0.01, 0.5, (fx, v) => { uni(fx.pass, 'uLuma').value = v }),
      P('desat', 'desat', 0, 1, 0.01, 0, (fx, v) => { uni(fx.pass, 'uDesat').value = v }),
    ],
    frame: (fx, t) => { uni(fx.pass, 'uTime').value = t.elapsed } },

  { id: 'ca', label: 'Chromatic aberration', group: 'Colour & grade',
    make: () => ({ pass: createChromaticAberration() }),
    params: [
      P('strength', 'strength', 0, 5, 0.05, 1, (fx, v) => { uni(fx.pass, 'uStrength').value = v }),
      P('scale', 'scale', 0, 3, 0.01, 1.2, (fx, v) => { uni(fx.pass, 'uScale').value = v }),
    ] },

  { id: 'anamorphic', label: 'Anamorphic flare', group: 'Colour & grade',
    make: () => ({ pass: createAnamorphic() }),
    params: [
      P('threshold', 'threshold', 0, 1, 0.01, 0.9, (fx, v) => { uni(fx.pass, 'uThreshold').value = v }),
      P('scale', 'scale', 0, 8, 0.1, 3, (fx, v) => { uni(fx.pass, 'uScale').value = v }),
      P('samples', 'samples', 4, 64, 1, 32, (fx, v) => { uni(fx.pass, 'uSamples').value = v }),
    ],
    resize: (fx, w, h) => fx.pass.setSize(w, h) },

  // — Blur & focus —
  { id: 'dof', label: 'Depth of field (bokeh)', group: 'Blur & focus',
    make: () => ({ pass: createDof(passCtx, { focus: 9, aperture: 0.0006, maxblur: 0.01 }) }),
    params: [
      P('focus', 'focus', 1, 25, 0.1, 9, (fx, v) => { uni(fx.pass, 'focus').value = v }),
      P('aperture', 'aperture', 0, 0.004, 0.0001, 0.0006, (fx, v) => { uni(fx.pass, 'aperture').value = v }),
      P('maxblur', 'maxblur', 0, 0.03, 0.001, 0.01, (fx, v) => { uni(fx.pass, 'maxblur').value = v }),
    ] },

  { id: 'radial', label: 'Radial (zoom) blur', group: 'Blur & focus',
    make: () => ({ pass: createRadialBlur() }),
    params: [
      P('weight', 'weight', 0, 1, 0.01, 0.9, (fx, v) => { uni(fx.pass, 'uWeight').value = v }),
      P('decay', 'decay', 0.8, 1, 0.001, 0.95, (fx, v) => { uni(fx.pass, 'uDecay').value = v }),
      P('exposure', 'exposure', 0, 10, 0.1, 5, (fx, v) => { uni(fx.pass, 'uExposure').value = v }),
      P('count', 'samples', 8, 128, 1, 32, (fx, v) => { uni(fx.pass, 'uCount').value = v }),
    ] },

  { id: 'motionblur', label: 'Motion blur', group: 'Blur & focus',
    make: () => {
      const pass = createMotionBlur()
      pass.setDepthTexture(composer.renderTarget1.depthTexture)
      return { pass }
    },
    params: [
      P('intensity', 'intensity', 0, 3, 0.01, 1, (fx, v) => { uni(fx.pass, 'uIntensity').value = v }),
      P('samples', 'samples', 4, 32, 1, 16, (fx, v) => { uni(fx.pass, 'uSamples').value = v }),
    ],
    frame: (fx) => fx.pass.update(camera) },

  // — Stylised —
  { id: 'crt', label: 'CRT', group: 'Stylised',
    make: () => ({ pass: createCrtPass({}) }),
    params: [
      P('curvature', 'curvature', 0, 0.5, 0.01, 0.12, (fx, v) => { uni(fx.pass, 'uCurvature').value = v }),
      P('vignette', 'vignette', 0, 1, 0.01, 0.35, (fx, v) => { uni(fx.pass, 'uVignette').value = v }),
      P('glitch', 'glitch', 0, 1, 0.01, 0.3, (fx, v) => { uni(fx.pass, 'uGlitch').value = v }),
    ],
    frame: (fx, t) => fx.pass.tick(t) },

  { id: 'retro', label: 'Retro (pixel + scanlines)', group: 'Stylised',
    make: () => ({ pass: createRetroPass() }),
    params: [
      P('pixelSize', 'pixel size', 1, 12, 1, 4, (fx, v) => { uni(fx.pass, 'uPixelSize').value = v }),
      P('colorLevels', 'colour levels', 2, 32, 1, 8, (fx, v) => { uni(fx.pass, 'uColorLevels').value = v }),
      P('scanline', 'scanlines', 0, 1, 0.01, 0.2, (fx, v) => { uni(fx.pass, 'uScanlineIntensity').value = v }),
    ],
    resize: (fx, w, h) => fx.pass.setSize(w, h) },

  { id: 'lensing', label: 'Gravitational lensing', group: 'Stylised',
    make: () => ({ pass: createLensingPass() }),
    params: [
      P('radius', 'radius', 0, 0.6, 0.01, 0.25, (fx, v) => { uni(fx.pass, 'uRadius').value = v }),
      P('strength', 'strength', 0, 1.5, 0.01, 0.5, (fx, v) => { uni(fx.pass, 'uStrength').value = v }),
      P('coreSize', 'core size', 0, 0.2, 0.005, 0.02, (fx, v) => { uni(fx.pass, 'uCoreSize').value = v }),
    ],
    resize: (fx, w, h) => fx.pass.setSize(w, h) },

  { id: 'afterimage', label: 'Afterimage (phosphor)', group: 'Stylised',
    make: () => ({ pass: createAfterimage() }),
    params: [ P('damp', 'damp', 0.7, 0.99, 0.005, 0.96, (fx, v) => { uni(fx.pass, 'damp').value = v }) ] },

  { id: 'sobel', label: 'Sobel edge detect', group: 'Stylised',
    make: () => ({ pass: createSobel() }),
    params: [],
    resize: (fx, w, h) => { const r = uni(fx.pass, 'resolution'); if (r) r.value.set(w, h) } },

  { id: 'burnin', label: 'Burn-in', group: 'Stylised',
    make: () => ({ pass: createBurnInPass({ decay: 0.92 }) }),
    params: [] },

  { id: 'glitchRgb', label: 'Glitch · RGB shift', group: 'Stylised',
    make: () => ({ pass: createRgbShiftPass() }),
    params: [
      P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => { uni(fx.pass, 'uIntensity').value = v }),
      P('angle', 'angle', 0, 6.28, 0.01, 0, (fx, v) => { uni(fx.pass, 'uAngle').value = v }),
    ],
    frame: (fx, t) => { uni(fx.pass, 'uTime').value = t.elapsed } },

  { id: 'glitchBlock', label: 'Glitch · block displace', group: 'Stylised',
    make: () => ({ pass: createBlockDisplacementPass() }),
    params: [
      P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => { uni(fx.pass, 'uIntensity').value = v }),
      P('blockSize', 'block size', 4, 128, 1, 32, (fx, v) => { uni(fx.pass, 'uBlockSize').value = v }),
    ],
    frame: (fx, t) => { uni(fx.pass, 'uTime').value = t.elapsed } },

  { id: 'glitchScan', label: 'Glitch · scan corruption', group: 'Stylised',
    make: () => ({ pass: createScanCorruptionPass() }),
    params: [ P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => { uni(fx.pass, 'uIntensity').value = v }) ],
    frame: (fx, t) => { uni(fx.pass, 'uTime').value = t.elapsed } },

  { id: 'pixelate', label: 'Pixelate', group: 'Stylised', note: true,
    make: () => ({ pass: createPixel(passCtx, { pixelSize: 6 }) }),
    params: [
      P('pixelSize', 'pixel size', 1, 24, 1, 6, (fx, v) => {
        if (typeof fx.pass.setPixelSize === 'function') fx.pass.setPixelSize(v)
        else fx.pass.pixelSize = v
      }),
      P('normalEdge', 'normal edges', 0, 2, 0.01, 0.3, (fx, v) => { fx.pass.normalEdgeStrength = v }),
      P('depthEdge', 'depth edges', 0, 2, 0.01, 0.4, (fx, v) => { fx.pass.depthEdgeStrength = v }),
    ] },

  // — Anti-aliasing —
  { id: 'fxaa', label: 'FXAA', group: 'Anti-aliasing',
    make: () => ({ pass: createFXAA() }), params: [],
    resize: (fx, w, h) => fx.pass.setSize?.(w, h) },

  { id: 'smaa', label: 'SMAA', group: 'Anti-aliasing',
    make: () => ({ pass: createSMAA() }), params: [],
    resize: (fx, w, h) => fx.pass.setSize?.(w, h) },

  { id: 'ssaa', label: 'SSAA (supersample)', group: 'Anti-aliasing', note: true,
    make: () => ({ pass: createSsaa(passCtx, { sampleLevel: 2 }) }),
    params: [ P('sampleLevel', 'sample level', 0, 4, 1, 2, (fx, v) => { fx.pass.sampleLevel = v }) ] },

  { id: 'traa', label: 'TRAA (temporal)', group: 'Anti-aliasing', note: true,
    make: () => { const pass = createTraa(passCtx, { sampleLevel: 2 }); pass.accumulate = false; return { pass } },
    params: [ P('sampleLevel', 'sample level', 0, 4, 1, 2, (fx, v) => { fx.pass.sampleLevel = v }) ] },

  // — Scene & geometry —
  { id: 'ao', label: 'Ambient occlusion (GTAO)', group: 'Scene & geometry', note: true,
    make: () => ({ pass: createAo(passCtx) }), params: [],
    resize: (fx, w, h) => fx.pass.setSize?.(w, h) },

  { id: 'outline', label: 'Outline (marked meshes)', group: 'Scene & geometry',
    make: () => ({ pass: createOutline(passCtx, { selectedObjects: marked, edgeStrength: 3, visibleEdgeColor: '#7aa2ff' }) }),
    params: [
      P('edgeStrength', 'edge strength', 0, 10, 0.1, 3, (fx, v) => { fx.pass.edgeStrength = v }),
      P('edgeGlow', 'edge glow', 0, 1, 0.01, 0, (fx, v) => { fx.pass.edgeGlow = v }),
      P('edgeThickness', 'edge thickness', 1, 4, 0.1, 1, (fx, v) => { fx.pass.edgeThickness = v }),
    ],
    resize: (fx, w, h) => fx.pass.setSize?.(w, h) },

  { id: 'ssr', label: 'Screen-space reflections', group: 'Scene & geometry', note: true,
    make: () => ({ pass: createSsr(passCtx, { selects: marked }) }), params: [],
    resize: (fx, w, h) => fx.pass.setSize?.(w, h) },
]

// —————————————————————————— build passes + UI ——————————————————————————

const list  = document.querySelector('[data-fx-list]')
const built = [] // { def, fx, enabled }
let currentGroup = null

for (const def of EFFECTS) {
  if (def.group !== currentGroup) {
    currentGroup = def.group
    const h = document.createElement('h2')
    h.textContent = currentGroup
    list.appendChild(h)
  }

  const row = document.createElement('div')
  row.dataset.fx = def.id
  if (def.note) row.dataset.note = ''

  let fx = null
  let broken = false
  try {
    fx = def.make()
    if (fx.pass && !def.builtin) {
      handle.addPassBeforeOutput(fx.pass)
      fx.pass.enabled = false
    }
  } catch (err) {
    broken = true
    row.dataset.broken = ''
    console.warn(`[demo] effect "${def.id}" unavailable:`, err)
  }

  const entry = { def, fx, enabled: false }
  built.push(entry)

  // enable toggle
  const check = document.createElement('label')
  check.dataset.check = ''
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.disabled = broken
  const name = document.createElement('span')
  name.textContent = broken ? `${def.label} — unavailable` : def.label
  check.append(box, name)
  row.appendChild(check)

  // params
  const params = document.createElement('div')
  params.dataset.params = ''
  params.hidden = true

  for (const p of def.params) {
    const label = document.createElement('label')
    label.dataset.range = ''
    const span = document.createElement('span'); span.textContent = p.label
    const out  = document.createElement('output'); out.textContent = fmt(p.value)
    const range = document.createElement('input')
    range.type = 'range'
    range.min = p.min; range.max = p.max; range.step = p.step; range.value = p.value
    range.addEventListener('input', () => {
      const v = Number(range.value)
      out.textContent = fmt(v)
      if (fx) try { p.apply(fx, v, passCtx) } catch (e) { console.warn(e) }
    })
    label.append(span, range, out)
    params.appendChild(label)
    // apply initial value so the pass matches the slider
    if (fx) try { p.apply(fx, p.value, passCtx) } catch (e) { /* ignore */ }
  }
  row.appendChild(params)

  box.addEventListener('change', () => setEnabled(entry, box.checked, params))

  // default-on effects (bloom)
  if (def.enabled && !broken) { box.checked = true; setEnabled(entry, true, params) }

  list.appendChild(row)
}

function setEnabled (entry, on, paramsEl) {
  entry.enabled = on
  paramsEl.hidden = !on
  const { def, fx } = entry
  if (!fx) return
  if (fx.pass) fx.pass.enabled = on
  if (on && fx.attach) fx.attach()
  if (!on && fx.detach) fx.detach()
}

// —————————————————————————— reset ——————————————————————————

document.querySelector('[data-reset]').addEventListener('click', () => {
  for (const row of list.querySelectorAll('[data-fx]')) {
    const entry = built.find(b => b.def.id === row.dataset.fx)
    const box   = row.querySelector('input[type=checkbox]')
    const params = row.querySelector('[data-params]')
    // restore slider defaults + reapply
    row.querySelectorAll('label[data-range]').forEach((label, i) => {
      const p = entry.def.params[i]
      const range = label.querySelector('input')
      const out = label.querySelector('output')
      range.value = p.value; out.textContent = fmt(p.value)
      if (entry.fx) try { p.apply(entry.fx, p.value, passCtx) } catch (e) { /* ignore */ }
    })
    const want = Boolean(entry.def.enabled)
    if (box && !box.disabled) { box.checked = want; setEnabled(entry, want, params) }
  }
})

// —————————————————————————— resize ——————————————————————————

function onResize () {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  handle.setSize(w, h)
  passCtx.width = w; passCtx.height = h
  for (const { def, fx } of built)
    if (fx && def.resize) try { def.resize(fx, w, h) } catch (e) { /* ignore */ }
}
window.addEventListener('resize', onResize)

// —————————————————————————— animate ——————————————————————————

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const startTime    = performance.now() / 1000
let lastTime       = startTime

function animate () {
  requestAnimationFrame(animate)
  const now     = performance.now() / 1000
  const delta   = Math.min(now - lastTime, 0.1) // clamp after tab-switch stalls
  const elapsed = now - startTime
  lastTime      = now
  const t       = { delta, elapsed, frame: 0 }

  if (!reduceMotion) {
    sculpture.rotation.y = elapsed * 0.25
    sculpture.children.forEach((m, i) => { m.rotation.x = elapsed * (0.3 + i * 0.05) })
  }
  controls.update()

  for (const { def, fx, enabled } of built)
    if (fx && enabled && def.frame) try { def.frame(fx, t) } catch (e) { /* ignore */ }

  composer.render(delta)
}

function fmt (v) {
  const n = Number(v)
  if (Math.abs(n) >= 100 || Number.isInteger(n)) return String(n)
  if (Math.abs(n) < 0.01) return n.toFixed(4)
  return n.toFixed(2)
}

onResize()
animate()
