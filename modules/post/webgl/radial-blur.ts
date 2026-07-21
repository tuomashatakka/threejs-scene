// lib/post/webgl/radial-blur.ts
// Radial (zoom) blur radiating from a screen-space centre — fakes light shafts
// / "god rays" by smearing brightness outward. WebGL ShaderPass equivalent of
// the WebGPU `radialBlur` TSL node. Same knobs: center, weight, decay, count,
// exposure. Unlike the depth-aware godrays pass this ignores 3D depth (the
// centre is a flat 2D point), so it is not physically correct lighting.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'

import { FULLSCREEN_VERTEX } from '../shared/glsl.js'


const RADIAL_BLUR_SHADER = {
  uniforms: {
    tDiffuse:  { value: null },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uWeight:   { value: 1.0 },
    uDecay:    { value: 0.92 },
    uExposure: { value: 1.0 },
    uCount:    { value: 32 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uWeight, uDecay, uExposure;
    uniform int uCount;
    varying vec2 vUv;
    void main () {
      // March from the fragment toward the centre, accumulating samples with a
      // decaying weight (same scheme as the radialBlur node / GPU Gems shafts).
      vec2 delta = (vUv - uCenter) / float(uCount);
      vec2 coord = vUv;
      vec3 sum = vec3(0.0);
      float illum = uWeight;
      float totalWeight = 0.0;
      for (int i = 0; i < 128; i++) {
        if (i >= uCount) break;
        coord -= delta;
        sum += texture2D(tDiffuse, coord).rgb * illum;
        totalWeight += illum;
        illum *= uDecay;
      }
      // Normalise by the accumulated weight (NOT the sample count) so the result
      // is a true weighted average — brightness is preserved. uExposure is then
      // an explicit, honest gain rather than a hidden count/weight ratio.
      sum /= max(totalWeight, 1e-4);
      sum *= uExposure;
      gl_FragColor = vec4(sum, texture2D(tDiffuse, vUv).a);
    }
  `,
}

export interface RadialBlurOptions {
  center?:   THREE.Vector2
  // Base weight of the first sample, [0,1].
  weight?:   number
  // Per-iteration weight falloff, [0,1]. Lower = a tighter, shorter smear.
  decay?:    number
  // Iteration count, recommended [16,64].
  count?:    number
  // Overall brightness gain applied after normalisation. 1.0 preserves brightness;
  // raise it for a glowing shaft look.
  exposure?: number
}

export function createRadialBlur (options: RadialBlurOptions = {}): Pass {
  const { center = new THREE.Vector2(0.5, 0.5), weight = 1.0, decay = 0.92, count = 32, exposure = 1.0 } = options
  const pass                                                                                             = new ShaderPass(RADIAL_BLUR_SHADER);
  (pass.uniforms.uCenter!.value as THREE.Vector2).copy(center)
  pass.uniforms.uWeight!.value   = weight
  pass.uniforms.uDecay!.value    = decay
  pass.uniforms.uCount!.value    = count
  pass.uniforms.uExposure!.value = exposure
  return pass
}

// perf: medium. up to `count` taps per fragment. Lower count for mobile.
