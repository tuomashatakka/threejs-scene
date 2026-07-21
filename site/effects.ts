// site/effects.ts
// The post-processing effect registry + control-panel builder, powered by the
// real library: every pass comes from a @tuomashatakka/threejs-scene/modules/post
// factory (resolved to the built package), assembled through postProcessing()'s
// `effects` hook. buildRegistry() instantiates the catalogue (guarded — a factory
// that throws becomes a disabled row), driveFrame/driveResize feed the module's
// onFrame/onResize hooks, and createEffectsPanel() renders the controls.

import * as THREE from 'three'

import { createBloom } from '@tuomashatakka/threejs-scene/modules/post/webgl/bloom'
import { createChromaticAberration } from '@tuomashatakka/threejs-scene/modules/post/webgl/ca'
import { createAnamorphic } from '@tuomashatakka/threejs-scene/modules/post/webgl/anamorphic'
import { createCrtPass } from '@tuomashatakka/threejs-scene/modules/post/webgl/crt'
import { createRetroPass } from '@tuomashatakka/threejs-scene/modules/post/webgl/retro'
import { createLensingPass } from '@tuomashatakka/threejs-scene/modules/post/webgl/lensing'
import { createAfterimage } from '@tuomashatakka/threejs-scene/modules/post/webgl/afterimage'
import { createSobel } from '@tuomashatakka/threejs-scene/modules/post/webgl/sobel'
import { createRadialBlur } from '@tuomashatakka/threejs-scene/modules/post/webgl/radial-blur'
import { createDof } from '@tuomashatakka/threejs-scene/modules/post/webgl/dof'
import { createMotionBlur } from '@tuomashatakka/threejs-scene/modules/post/webgl/motion-blur'
import { createFXAA } from '@tuomashatakka/threejs-scene/modules/post/webgl/fxaa'
import { createSMAA } from '@tuomashatakka/threejs-scene/modules/post/webgl/smaa'
import { createSsaa } from '@tuomashatakka/threejs-scene/modules/post/webgl/ssaa'
import { createTraa } from '@tuomashatakka/threejs-scene/modules/post/webgl/traa'
import { createAo } from '@tuomashatakka/threejs-scene/modules/post/webgl/ao'
import { createOutline } from '@tuomashatakka/threejs-scene/modules/post/webgl/outline'
import { createSsr } from '@tuomashatakka/threejs-scene/modules/post/webgl/ssr'
import { createPixel } from '@tuomashatakka/threejs-scene/modules/post/webgl/pixel'
import { createBurnInPass } from '@tuomashatakka/threejs-scene/modules/post/webgl/burn-in'
import { createLUT } from '@tuomashatakka/threejs-scene/modules/post/webgl/lut'
import { createLensflare } from '@tuomashatakka/threejs-scene/modules/post/webgl/lensflare'
import { createGradePass } from '@tuomashatakka/threejs-scene/modules/post/grade-pass'
import { createFilmGrainPass } from '@tuomashatakka/threejs-scene/modules/post/film-grain-pass'
import { createGodRaysPass } from '@tuomashatakka/threejs-scene/modules/post/god-rays-pass'
import { createRgbShiftPass, createBlockDisplacementPass, createScanCorruptionPass } from '@tuomashatakka/threejs-scene/modules/post/glitch-passes'
import { createCinematicLUT } from '@tuomashatakka/threejs-scene/modules/post/cinematic-lut'

import { outlineTargets, sunMesh } from './scene'

import type { FrameContext, Size } from '@tuomashatakka/threejs-scene'
import type { EffectContext } from '@tuomashatakka/threejs-scene/modules/postprocessing'
import type { Pass } from '@tuomashatakka/threejs-scene/modules/post/webgl/types'


interface Param {
  key:   string
  label: string
  min:   number
  max:   number
  step:  number
  value: number
  apply (fx: Effect, v: number): void
}

export interface Effect {
  id:      string
  label:   string
  group:   string
  note?:   boolean
  enabled: boolean
  broken?: boolean
  pass?:   Pass
  attach?: () => void
  detach?: () => void
  params:  Param[]
  frame?:  (fx: Effect, frame: FrameContext) => void
  resize?: (fx: Effect, w: number, h: number) => void
}

// — strict-safe accessors for the loosely-typed three pass internals —
const uni = (pass: Pass, name: string): THREE.IUniform =>
  (pass as unknown as { uniforms: Record<string, THREE.IUniform> }).uniforms[name]!

const prop = <T>(pass: Pass): T => pass as unknown as T

const P = (key: string, label: string, min: number, max: number, step: number, value: number, apply: Param['apply']): Param =>
  ({ key, label, min, max, step, value, apply })

/** A soft radial sprite reused by the lens-flare ghosts. */
function flareTexture (): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128

  const g    = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,240,200,0.7)')
  grad.addColorStop(1, 'rgba(255,240,200,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

interface Def {
  id:       string
  label:    string
  group:    string
  note?:    boolean
  enabled?: boolean
  make ():  { pass?: Pass; attach?: () => void; detach?: () => void }
  params:   Param[]
  frame?:   (fx: Effect, frame: FrameContext) => void
  resize?:  (fx: Effect, w: number, h: number) => void
}

/**
 * Instantiate the full WebGL effect catalogue against a live scene. Returns one
 * {@link Effect} per catalogue entry; the passes are meant to be handed to
 * `postProcessing({ effects })`. Each `make()` is guarded so a single
 * unsupported effect degrades to `broken` rather than throwing the whole build.
 */
export function buildRegistry (ctx: EffectContext): Effect[] {
  const { scene, camera, composer, depthTexture } = ctx
  const passCtx                                   = { renderer: ctx.renderer, scene, camera, width: ctx.width, height: ctx.height }
  const sun                                       = sunMesh(scene)
  const tmp                                       = new THREE.Vector3()

  const defs: Def[] = [
    // — Bloom & light —
    { id:      'bloom',
      label:   'Bloom',
      group:   'Bloom & light',
      enabled: true,
      make:    () => ({ pass: createBloom() }),
      params:  [
        P('strength', 'strength', 0, 3, 0.01, 0.7, (fx, v) => {
          prop<{ strength: number }>(fx.pass!).strength = v
        }),
        P('radius', 'radius', 0, 1, 0.01, 0.4, (fx, v) => {
          prop<{ radius: number }>(fx.pass!).radius = v
        }),
        P('threshold', 'threshold', 0, 1, 0.01, 0.85, (fx, v) => {
          prop<{ threshold: number }>(fx.pass!).threshold = v
        }),
      ]},

    { id:     'godrays',
      label:  'God rays',
      group:  'Bloom & light',
      make:   () => ({ pass: createGodRaysPass() }),
      params: [
        P('exposure', 'exposure', 0, 1, 0.01, 0.25, (fx, v) => {
          uni(fx.pass!, 'uExposure').value = v
        }),
        P('decay', 'decay', 0.8, 1, 0.001, 0.95, (fx, v) => {
          uni(fx.pass!, 'uDecay').value = v
        }),
        P('density', 'density', 0, 1.5, 0.01, 0.9, (fx, v) => {
          uni(fx.pass!, 'uDensity').value = v
        }),
        P('weight', 'weight', 0, 1, 0.01, 0.4, (fx, v) => {
          uni(fx.pass!, 'uWeight').value = v
        }),
        P('samples', 'samples', 8, 100, 1, 60, (fx, v) => {
          uni(fx.pass!, 'uSamples').value = v
        }),
      ],
      frame: fx => {
        if (sun)
          prop<{ updateFromLight: (p: THREE.Vector3, c: THREE.Camera) => void }>(fx.pass!).updateFromLight(sun.getWorldPosition(tmp), camera)
      } },

    { id:    'lensflare',
      label: 'Lens flare (scene object)',
      group: 'Bloom & light',
      make:  () => {
        const tex   = flareTexture()
        const flare = createLensflare({ elements: [
          { texture: tex, size: 260, distance: 0 },
          { texture: tex, size: 60, distance: 0.6 },
          { texture: tex, size: 90, distance: 0.9 },
        ]})
        return { attach: () => sun?.add(flare), detach: () => sun?.remove(flare) }
      },
      params: []},

    // — Colour & grade —
    { id:     'grade',
      label:  'Colour grade',
      group:  'Colour & grade',
      make:   () => ({ pass: createGradePass({}) }),
      params: [
        P('contrast', 'contrast', 0.5, 2, 0.01, 1.05, (fx, v) => {
          uni(fx.pass!, 'uContrast').value = v
        }),
        P('saturation', 'saturation', 0, 2, 0.01, 1.1, (fx, v) => {
          uni(fx.pass!, 'uSaturation').value = v
        }),
        P('vignette', 'vignette', 0, 1, 0.01, 0.35, (fx, v) => {
          uni(fx.pass!, 'uVignette').value = v
        }),
        P('grain', 'grain', 0, 0.2, 0.005, 0.04, (fx, v) => {
          uni(fx.pass!, 'uGrain').value = v
        }),
        P('chromatic', 'chromatic', 0, 2, 0.01, 0.6, (fx, v) => {
          uni(fx.pass!, 'uChromatic').value = v
        }),
      ],
      frame: (fx, f) => prop<{ setTime: (t: number) => void }>(fx.pass!).setTime(f.elapsed) },

    { id:     'lut',
      label:  'Cinematic LUT',
      group:  'Colour & grade',
      make:   () => ({ pass: createLUT({ lut: createCinematicLUT(), intensity: 1 }) }),
      params: [ P('intensity', 'intensity', 0, 1, 0.01, 1, (fx, v) => {
        prop<{ intensity: number }>(fx.pass!).intensity = v
      }) ]},

    { id:     'filmgrain',
      label:  'Film grain',
      group:  'Colour & grade',
      make:   () => ({ pass: createFilmGrainPass({}) }),
      params: [
        P('intensity', 'intensity', 0, 0.4, 0.005, 0.08, (fx, v) => {
          uni(fx.pass!, 'uIntensity').value = v
        }),
        P('luma', 'luma', 0, 1, 0.01, 0.5, (fx, v) => {
          uni(fx.pass!, 'uLuma').value = v
        }),
        P('desat', 'desat', 0, 1, 0.01, 0, (fx, v) => {
          uni(fx.pass!, 'uDesat').value = v
        }),
      ],
      frame: (fx, f) => {
        uni(fx.pass!, 'uTime').value = f.elapsed
      } },

    { id:     'ca',
      label:  'Chromatic aberration',
      group:  'Colour & grade',
      make:   () => ({ pass: createChromaticAberration() }),
      params: [
        P('strength', 'strength', 0, 5, 0.05, 1, (fx, v) => {
          uni(fx.pass!, 'uStrength').value = v
        }),
        P('scale', 'scale', 0, 3, 0.01, 1.2, (fx, v) => {
          uni(fx.pass!, 'uScale').value = v
        }),
      ]},

    { id:     'anamorphic',
      label:  'Anamorphic flare',
      group:  'Colour & grade',
      make:   () => ({ pass: createAnamorphic() }),
      params: [
        P('threshold', 'threshold', 0, 1, 0.01, 0.9, (fx, v) => {
          uni(fx.pass!, 'uThreshold').value = v
        }),
        P('scale', 'scale', 0, 8, 0.1, 3, (fx, v) => {
          uni(fx.pass!, 'uScale').value = v
        }),
        P('samples', 'samples', 4, 64, 1, 32, (fx, v) => {
          uni(fx.pass!, 'uSamples').value = v
        }),
      ],
      resize: (fx, w, h) => prop<{ setSize: (w: number, h: number) => void }>(fx.pass!).setSize(w, h) },

    // — Blur & focus —
    { id:     'dof',
      label:  'Depth of field (bokeh)',
      group:  'Blur & focus',
      make:   () => ({ pass: createDof(passCtx, { focus: 9, aperture: 0.0006, maxblur: 0.01 }) }),
      params: [
        P('focus', 'focus', 1, 25, 0.1, 9, (fx, v) => {
          uni(fx.pass!, 'focus').value = v
        }),
        P('aperture', 'aperture', 0, 0.004, 0.0001, 0.0006, (fx, v) => {
          uni(fx.pass!, 'aperture').value = v
        }),
        P('maxblur', 'maxblur', 0, 0.03, 0.001, 0.01, (fx, v) => {
          uni(fx.pass!, 'maxblur').value = v
        }),
      ]},

    { id:     'radial',
      label:  'Radial (zoom) blur',
      group:  'Blur & focus',
      make:   () => ({ pass: createRadialBlur() }),
      params: [
        P('weight', 'weight', 0, 1, 0.01, 0.9, (fx, v) => {
          uni(fx.pass!, 'uWeight').value = v
        }),
        P('decay', 'decay', 0.8, 1, 0.001, 0.95, (fx, v) => {
          uni(fx.pass!, 'uDecay').value = v
        }),
        P('exposure', 'exposure', 0, 10, 0.1, 5, (fx, v) => {
          uni(fx.pass!, 'uExposure').value = v
        }),
        P('count', 'samples', 8, 128, 1, 32, (fx, v) => {
          uni(fx.pass!, 'uCount').value = v
        }),
      ]},

    { id:    'motionblur',
      label: 'Motion blur',
      group: 'Blur & focus',
      make:  () => {
        const pass = createMotionBlur()
        prop<{ setDepthTexture: (t: THREE.Texture | null) => void }>(pass).setDepthTexture(depthTexture)
        return { pass }
      },
      params: [
        P('intensity', 'intensity', 0, 3, 0.01, 1, (fx, v) => {
          uni(fx.pass!, 'uIntensity').value = v
        }),
        P('samples', 'samples', 4, 32, 1, 16, (fx, v) => {
          uni(fx.pass!, 'uSamples').value = v
        }),
      ],
      frame: fx => prop<{ update: (c: THREE.Camera) => void }>(fx.pass!).update(camera) },

    // — Stylised —
    { id:     'crt',
      label:  'CRT',
      group:  'Stylised',
      make:   () => ({ pass: createCrtPass({}) }),
      params: [
        P('curvature', 'curvature', 0, 0.5, 0.01, 0.12, (fx, v) => {
          uni(fx.pass!, 'uCurvature').value = v
        }),
        P('vignette', 'vignette', 0, 1, 0.01, 0.35, (fx, v) => {
          uni(fx.pass!, 'uVignette').value = v
        }),
        P('glitch', 'glitch', 0, 1, 0.01, 0.3, (fx, v) => {
          uni(fx.pass!, 'uGlitch').value = v
        }),
      ],
      frame: (fx, f) => prop<{ tick: (f: FrameContext) => void }>(fx.pass!).tick(f) },

    { id:     'retro',
      label:  'Retro (pixel + scanlines)',
      group:  'Stylised',
      make:   () => ({ pass: createRetroPass() }),
      params: [
        P('pixelSize', 'pixel size', 1, 12, 1, 4, (fx, v) => {
          uni(fx.pass!, 'uPixelSize').value = v
        }),
        P('colorLevels', 'colour levels', 2, 32, 1, 8, (fx, v) => {
          uni(fx.pass!, 'uColorLevels').value = v
        }),
        P('scanline', 'scanlines', 0, 1, 0.01, 0.2, (fx, v) => {
          uni(fx.pass!, 'uScanlineIntensity').value = v
        }),
      ],
      resize: (fx, w, h) => prop<{ setSize: (w: number, h: number) => void }>(fx.pass!).setSize(w, h) },

    { id:     'lensing',
      label:  'Gravitational lensing',
      group:  'Stylised',
      make:   () => ({ pass: createLensingPass() }),
      params: [
        P('radius', 'radius', 0, 0.6, 0.01, 0.25, (fx, v) => {
          uni(fx.pass!, 'uRadius').value = v
        }),
        P('strength', 'strength', 0, 1.5, 0.01, 0.5, (fx, v) => {
          uni(fx.pass!, 'uStrength').value = v
        }),
        P('coreSize', 'core size', 0, 0.2, 0.005, 0.02, (fx, v) => {
          uni(fx.pass!, 'uCoreSize').value = v
        }),
      ],
      resize: (fx, w, h) => prop<{ setSize: (w: number, h: number) => void }>(fx.pass!).setSize(w, h) },

    { id:     'afterimage',
      label:  'Afterimage (phosphor)',
      group:  'Stylised',
      make:   () => ({ pass: createAfterimage() }),
      params: [ P('damp', 'damp', 0.7, 0.99, 0.005, 0.96, (fx, v) => {
        uni(fx.pass!, 'damp').value = v
      }) ]},

    { id:     'sobel',
      label:  'Sobel edge detect',
      group:  'Stylised',
      make:   () => ({ pass: createSobel() }),
      params: [],
      resize: (fx, w, h) => {
        uni(fx.pass!, 'resolution').value.set(w, h)
      } },

    { id:     'burnin',
      label:  'Burn-in',
      group:  'Stylised',
      make:   () => ({ pass: createBurnInPass({ decay: 0.92 }) }),
      params: []},

    { id:     'glitchRgb',
      label:  'Glitch · RGB shift',
      group:  'Stylised',
      make:   () => ({ pass: createRgbShiftPass() }),
      params: [
        P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => {
          uni(fx.pass!, 'uIntensity').value = v
        }),
        P('angle', 'angle', 0, 6.28, 0.01, 0, (fx, v) => {
          uni(fx.pass!, 'uAngle').value = v
        }),
      ],
      frame: (fx, f) => {
        uni(fx.pass!, 'uTime').value = f.elapsed
      } },

    { id:     'glitchBlock',
      label:  'Glitch · block displace',
      group:  'Stylised',
      make:   () => ({ pass: createBlockDisplacementPass() }),
      params: [
        P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => {
          uni(fx.pass!, 'uIntensity').value = v
        }),
        P('blockSize', 'block size', 4, 128, 1, 32, (fx, v) => {
          uni(fx.pass!, 'uBlockSize').value = v
        }),
      ],
      frame: (fx, f) => {
        uni(fx.pass!, 'uTime').value = f.elapsed
      } },

    { id:     'glitchScan',
      label:  'Glitch · scan corruption',
      group:  'Stylised',
      make:   () => ({ pass: createScanCorruptionPass() }),
      params: [ P('intensity', 'intensity', 0, 3, 0.01, 0.5, (fx, v) => {
        uni(fx.pass!, 'uIntensity').value = v
      }) ],
      frame: (fx, f) => {
        uni(fx.pass!, 'uTime').value = f.elapsed
      } },

    { id:     'pixelate',
      label:  'Pixelate',
      group:  'Stylised',
      note:   true,
      make:   () => ({ pass: createPixel(passCtx, { pixelSize: 6 }) }),
      params: [
        P('pixelSize', 'pixel size', 1, 24, 1, 6, (fx, v) => {
          const p = prop<{ setPixelSize?: (n: number) => void; pixelSize?: number }>(fx.pass!)
          if (typeof p.setPixelSize === 'function')
            p.setPixelSize(v)
          else
            p.pixelSize = v
        }),
        P('normalEdge', 'normal edges', 0, 2, 0.01, 0.3, (fx, v) => {
          prop<{ normalEdgeStrength: number }>(fx.pass!).normalEdgeStrength = v
        }),
        P('depthEdge', 'depth edges', 0, 2, 0.01, 0.4, (fx, v) => {
          prop<{ depthEdgeStrength: number }>(fx.pass!).depthEdgeStrength = v
        }),
      ]},

    // — Anti-aliasing —
    { id:     'fxaa',
      label:  'FXAA',
      group:  'Anti-aliasing',
      make:   () => ({ pass: createFXAA() }),
      params: [],
      resize: (fx, w, h) => prop<{ setSize?: (w: number, h: number) => void }>(fx.pass!).setSize?.(w, h) },

    { id:     'smaa',
      label:  'SMAA',
      group:  'Anti-aliasing',
      make:   () => ({ pass: createSMAA() }),
      params: [],
      resize: (fx, w, h) => prop<{ setSize?: (w: number, h: number) => void }>(fx.pass!).setSize?.(w, h) },

    { id:     'ssaa',
      label:  'SSAA (supersample)',
      group:  'Anti-aliasing',
      note:   true,
      make:   () => ({ pass: createSsaa(passCtx, { sampleLevel: 2 }) }),
      params: [ P('sampleLevel', 'sample level', 0, 4, 1, 2, (fx, v) => {
        prop<{ sampleLevel: number }>(fx.pass!).sampleLevel = v
      }) ]},

    { id:    'traa',
      label: 'TRAA (temporal)',
      group: 'Anti-aliasing',
      note:  true,
      make:  () => {
        const pass                                     = createTraa(passCtx, { sampleLevel: 2 })
        prop<{ accumulate: boolean }>(pass).accumulate = false
        return { pass }
      },
      params: [ P('sampleLevel', 'sample level', 0, 4, 1, 2, (fx, v) => {
        prop<{ sampleLevel: number }>(fx.pass!).sampleLevel = v
      }) ]},

    // — Scene & geometry —
    { id:     'ao',
      label:  'Ambient occlusion (GTAO)',
      group:  'Scene & geometry',
      note:   true,
      make:   () => ({ pass: createAo(passCtx) }),
      params: [],
      resize: (fx, w, h) => prop<{ setSize?: (w: number, h: number) => void }>(fx.pass!).setSize?.(w, h) },

    { id:     'outline',
      label:  'Outline (marked meshes)',
      group:  'Scene & geometry',
      make:   () => ({ pass: createOutline(passCtx, { selectedObjects: outlineTargets(scene), edgeStrength: 3, visibleEdgeColor: '#7aa2ff' }) }),
      params: [
        P('edgeStrength', 'edge strength', 0, 10, 0.1, 3, (fx, v) => {
          prop<{ edgeStrength: number }>(fx.pass!).edgeStrength = v
        }),
        P('edgeGlow', 'edge glow', 0, 1, 0.01, 0, (fx, v) => {
          prop<{ edgeGlow: number }>(fx.pass!).edgeGlow = v
        }),
        P('edgeThickness', 'edge thickness', 1, 4, 0.1, 1, (fx, v) => {
          prop<{ edgeThickness: number }>(fx.pass!).edgeThickness = v
        }),
      ],
      resize: (fx, w, h) => prop<{ setSize?: (w: number, h: number) => void }>(fx.pass!).setSize?.(w, h) },

    { id:     'ssr',
      label:  'Screen-space reflections',
      group:  'Scene & geometry',
      note:   true,
      make:   () => ({ pass: createSsr(passCtx, { selects: outlineTargets(scene) as THREE.Mesh[] }) }),
      params: [],
      resize: (fx, w, h) => prop<{ setSize?: (w: number, h: number) => void }>(fx.pass!).setSize?.(w, h) },
  ]

  return defs.map(def => {
    const fx: Effect = {
      id:      def.id,
      label:   def.label,
      group:   def.group,
      note:    def.note,
      enabled: false,
      params:  def.params,
      frame:   def.frame,
      resize:  def.resize,
    }
    try {
      const m   = def.make()
      fx.pass   = m.pass
      fx.attach = m.attach
      fx.detach = m.detach
    }
    catch (err) {
      fx.broken = true
      console.warn(`[effects] "${def.id}" unavailable:`, err)
    }
    if (!fx.broken) {
      for (const p of fx.params)
        try {
          p.apply(fx, p.value)
        }
        catch { /* ignore */ }
      if (def.enabled)
        fx.enabled = true
    }
    if (fx.pass)
      fx.pass.enabled = fx.enabled
    if (fx.enabled)
      fx.attach?.()
    return fx
  })
}

/** Passes to hand to postProcessing({ effects }). */
export const registryPasses = (registry: Effect[]): Pass[] =>
  registry.flatMap(fx => fx.pass ? [ fx.pass ] : [])

/** postProcessing onFrame: drive time/camera uniforms on enabled effects. */
export function driveFrame (registry: Effect[], frame: FrameContext): void {
  for (const fx of registry)
    if (fx.enabled && fx.frame)
      try {
        fx.frame(fx, frame)
      }
      catch { /* ignore */ }
}

/** postProcessing onResize: forward to resolution-tracking effects. */
export function driveResize (registry: Effect[], size: Size): void {
  for (const fx of registry)
    if (fx.pass && fx.resize)
      try {
        fx.resize(fx, size.width, size.height)
      }
      catch { /* ignore */ }
}

function setEnabled (fx: Effect, on: boolean, paramsEl: HTMLElement): void {
  fx.enabled      = on
  paramsEl.hidden = !on
  if (fx.pass)
    fx.pass.enabled = on
  if (on)
    fx.attach?.()
  else
    fx.detach?.()
}

function fmt (v: number): string {
  if (Math.abs(v) >= 100 || Number.isInteger(v))
    return String(v)
  if (Math.abs(v) < 0.01)
    return v.toFixed(4)
  return v.toFixed(2)
}

/**
 * Render the control panel into `listEl`, one group per effect category, each a
 * toggle + a slider per parameter. Wires a `[data-reset]` button if present.
 */
export function createEffectsPanel (registry: Effect[], listEl: HTMLElement): void {
  let currentGroup = ''
  const resets: Array<() => void> = []

  for (const fx of registry) {
    if (fx.group !== currentGroup) {
      currentGroup = fx.group

      const h       = document.createElement('h2')
      h.textContent = currentGroup
      listEl.appendChild(h)
    }

    const row      = document.createElement('div')
    row.dataset.fx = fx.id
    if (fx.note)
      row.dataset.note = ''
    if (fx.broken)
      row.dataset.broken = ''

    const check         = document.createElement('label')
    check.dataset.check = ''

    const box    = document.createElement('input')
    box.type     = 'checkbox'
    box.disabled = Boolean(fx.broken)
    box.checked  = fx.enabled

    const name       = document.createElement('span')
    name.textContent = fx.broken ? `${fx.label} — unavailable` : fx.label
    check.append(box, name)
    row.appendChild(check)

    const params          = document.createElement('div')
    params.dataset.params = ''
    params.hidden         = !fx.enabled

    for (const p of fx.params) {
      const label         = document.createElement('label')
      label.dataset.range = ''

      const span          = document.createElement('span'); span.textContent = p.label

      const out                                                     = document.createElement('output'); out.textContent = fmt(p.value)

      const range = document.createElement('input')
      range.type  = 'range'
      range.min   = String(p.min); range.max = String(p.max); range.step = String(p.step); range.value = String(p.value)
      range.addEventListener('input', () => {
        const v         = Number(range.value)
        out.textContent = fmt(v)
        if (fx.pass)
          try {
            p.apply(fx, v)
          }
          catch { /* ignore */ }
      })
      label.append(span, range, out)
      params.appendChild(label)
      resets.push(() => {
        range.value     = String(p.value)
        out.textContent = fmt(p.value)
        if (fx.pass)
          try {
            p.apply(fx, p.value)
          }
          catch { /* ignore */ }
      })
    }
    row.appendChild(params)

    box.addEventListener('change', () => setEnabled(fx, box.checked, params))
    resets.push(() => {
      if (box.disabled)
        return
      box.checked = fx.enabled // will be normalised below
    })

    listEl.appendChild(row)
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('[data-reset]')
  resetBtn?.addEventListener('click', () => {
    for (const r of resets)
      r()
  })
}
