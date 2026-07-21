// lib/post/webgl/ca.ts
// Chromatic aberration — splits R/G/B radially from a centre point for a lens
// fringing look. WebGL ShaderPass equivalent of the WebGPU `webgpu/ca.ts`
// (ChromaticAberrationNode). Same knobs: strength, center, scale.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'

import { FULLSCREEN_VERTEX, GLSL_CHROMATIC } from '../shared/glsl.js'


const CA_SHADER = {
  uniforms: {
    tDiffuse:  { value: null },
    uStrength: { value: 1 },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uScale:    { value: 1.2 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStrength, uScale;
    uniform vec2 uCenter;
    varying vec2 vUv;
    ${GLSL_CHROMATIC}
    void main () {
      // Offset grows with distance from the centre; channels separate along it.
      vec2 dir = vUv - uCenter;
      vec2 off = dir * uStrength * 0.01 * uScale;
      gl_FragColor = vec4(chromaticSample(tDiffuse, vUv, off), texture2D(tDiffuse, vUv).a);
    }
  `,
}

export interface ChromaticAberrationOptions {
  // Fringe magnitude.
  strength?: number
  // Centre of the radial split in screen UV (0..1).
  center?:   THREE.Vector2
  // Per-channel scale falloff.
  scale?:    number
}

export function createChromaticAberration (options: ChromaticAberrationOptions = {}): Pass {
  const { strength = 1, center = new THREE.Vector2(0.5, 0.5), scale = 1.2 } = options
  const pass                                                                = new ShaderPass(CA_SHADER)
  pass.uniforms.uStrength!.value                                            = strength;
  (pass.uniforms.uCenter!.value as THREE.Vector2).copy(center)
  pass.uniforms.uScale!.value = scale
  return pass
}

// perf: low. Three texture taps with a radial offset.
