// lib/post/webgl/bloom-selective.ts
// Selective bloom — only objects you opt in glow, the rest stay sharp. WebGL
// equivalent of the WebGPU `webgpu/bloom-selective.ts`. WebGL has no emissive
// MRT channel, so this uses the canonical two-composer technique: render the
// scene with non-bloom objects swapped to black, bloom that buffer, then
// additively composite it over a normal render via a mix shader. Returns a
// stateful handle (not a single Pass) — drive it with `handle.render()`.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { FULLSCREEN_VERTEX } from '../shared/glsl.js'

import type { Disposable } from '../../../lib/index.js'
import type { WebGlPassContext } from './types.js'


// Objects on this layer bloom. Enable it on a mesh with `obj.layers.enable(BLOOM_LAYER)`.
export const BLOOM_LAYER = 1

export interface SelectiveBloomOptions {
  strength?:  number
  radius?:    number
  threshold?: number

  /**
   * Gain applied to the bloom buffer when it is composited over the scene,
   * independent of the blur's own `strength`. @defaultValue 1
   */
  compositeStrength?: number
}

export interface SelectiveBloomHandle extends Disposable {
  bloomComposer: EffectComposer
  finalComposer: EffectComposer
  bloom:         UnrealBloomPass
  // Opt an object (and optionally its descendants) into the glow.
  markBloom (object: THREE.Object3D, recursive?: boolean): void
  unmarkBloom (object: THREE.Object3D, recursive?: boolean): void
  // Render the full selective-bloom result to screen. Call instead of renderer.render.
  render (): void
  setSize (width: number, height: number): void

  /** Dial the composited glow without rebuilding the chain. */
  setCompositeStrength (strength: number): void
}

export function createSelectiveBloom (
  ctx: WebGlPassContext,
  options: SelectiveBloomOptions = {},
): SelectiveBloomHandle {
  const { renderer, scene, camera, width, height }                           = ctx
  const { strength = 1, radius = 0.4, threshold = 0, compositeStrength = 1 } = options

  const bloomLayer = new THREE.Layers()
  bloomLayer.set(BLOOM_LAYER)

  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const saved        = new Map<string, THREE.Material | THREE.Material[]>()

  // Bloom pass: renders only the bright/marked objects, blurred. Not to screen.
  const bloom                  = new UnrealBloomPass(new THREE.Vector2(width, height), strength, radius, threshold)
  const bloomComposer          = new EffectComposer(renderer)
  bloomComposer.renderToScreen = false
  bloomComposer.addPass(new RenderPass(scene, camera))
  bloomComposer.addPass(bloom)

  // Mix pass: scene colour + bloom buffer, additively.
  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture:    { value: null },
        bloomTexture:   { value: bloomComposer.renderTarget2.texture },
        uBloomStrength: { value: 1 },
      },
      vertexShader:   FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */`
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        uniform float uBloomStrength;
        varying vec2 vUv;
        void main () {
          vec4 base = texture2D(baseTexture, vUv);
          // Additive composite, scaled at composite time. (The old code multiplied
          // by vec4(1.0) — a no-op with no way to dial the glow back.) Keep the
          // base alpha so the chain stays composable.
          vec3 bloom = texture2D(bloomTexture, vUv).rgb * uBloomStrength;
          gl_FragColor = vec4(base.rgb + bloom, base.a);
        }
      `,
      defines: {},
    }),
    'baseTexture',
  )
  mixPass.needsSwap                      = true
  mixPass.uniforms.uBloomStrength!.value = compositeStrength

  const finalComposer = new EffectComposer(renderer)
  finalComposer.addPass(new RenderPass(scene, camera))
  finalComposer.addPass(mixPass)
  finalComposer.addPass(new OutputPass())

  bloomComposer.setSize(width, height)
  finalComposer.setSize(width, height)

  function darken (obj: THREE.Object3D): void {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && bloomLayer.test(obj.layers) === false) {
      saved.set(obj.uuid, mesh.material)
      mesh.material = darkMaterial
    }
  }
  function restore (obj: THREE.Object3D): void {
    if (saved.has(obj.uuid)) {
      (obj as THREE.Mesh).material = saved.get(obj.uuid)!
      saved.delete(obj.uuid)
    }
  }

  return {
    bloomComposer,
    finalComposer,
    bloom,
    markBloom (object, recursive = true) {
      if (recursive)
        object.traverse(o => o.layers.enable(BLOOM_LAYER))
      else
        object.layers.enable(BLOOM_LAYER)
    },
    unmarkBloom (object, recursive = true) {
      if (recursive)
        object.traverse(o => o.layers.disable(BLOOM_LAYER))
      else
        object.layers.disable(BLOOM_LAYER)
    },
    render () {
      scene.traverse(darken)
      bloomComposer.render()
      scene.traverse(restore)
      finalComposer.render()
    },
    setSize (w, h) {
      bloomComposer.setSize(w, h)
      finalComposer.setSize(w, h)
      bloom.setSize(w, h)
    },
    setCompositeStrength (value) {
      mixPass.uniforms.uBloomStrength!.value = value
    },
    dispose () {
      bloomComposer.dispose()
      finalComposer.dispose()
      darkMaterial.dispose()
    },
  }
}

// perf: medium-expensive. Two full composer chains; the scene is rendered twice.
