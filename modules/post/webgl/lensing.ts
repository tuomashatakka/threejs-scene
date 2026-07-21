// lib/post/webgl/lensing.ts
// Screen-space gravitational lensing: pixels near a screen-space center are
// pulled around it, with an optional dark core (event horizon). Drive uCenter
// each frame from core/projection.ts projectToScreenUv on the lensing body.
// Ported from stellar-cartogrph's lensing shader.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { FULLSCREEN_VERTEX } from '../shared/glsl.js'


const LENSING_SHADER = {
  uniforms: {
    tDiffuse:  { value: null },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uRadius:   { value: 0.25 },
    uStrength: { value: 0.5 },
    uCoreSize: { value: 0.02 },
    uAspect:   { value: 1 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uRadius, uStrength, uCoreSize, uAspect;
    varying vec2 vUv;
    void main () {
      vec2 toCenter = vUv - uCenter;
      toCenter.x *= uAspect;
      float dist = length(toCenter);
      // Deflection falls off with distance. The 1/dist term diverges at the
      // centre, so soften the denominator with the core radius (a Plummer-style
      // softening) and clamp the result — without this the sampling offset
      // explodes near the centre and smears a hard ring around the core.
      float soft = max(uCoreSize, 1e-3);
      float deflect = uStrength * uRadius * uRadius / (dist + soft);
      deflect = min(deflect, uRadius);
      float influence = smoothstep(uRadius, 0.0, dist);
      // normalize() is undefined at the origin — guard the direction too.
      vec2 dir = dist > 1e-5 ? toCenter / dist : vec2(0.0);
      vec2 offset = dir * deflect * influence;
      offset.x /= uAspect;
      vec3 c = texture2D(tDiffuse, vUv - offset).rgb;
      // Event horizon: darken inside the core, fading out over the full core
      // radius so the transition reads as a soft shadow rather than a hard edge.
      c *= smoothstep(0.0, uCoreSize, dist);
      gl_FragColor = vec4(c, texture2D(tDiffuse, vUv).a);
    }
  `,
}

export interface LensingOptions {

  /** Influence radius in UV units. */
  radius?:   number
  strength?: number

  /** Dark-core (event horizon) radius in UV units; 0 disables. */
  coreSize?: number
}

export interface LensingPass extends ShaderPass {

  /** Point the lens at a screen UV (see core/projection.ts). */
  setCenter (u: number, v: number): void
  setSize (width: number, height: number): void
}

export function createLensingPass ({ radius = 0.25, strength = 0.5, coreSize = 0.02 }: LensingOptions = {}): LensingPass {
  const pass = new ShaderPass(LENSING_SHADER) as LensingPass

  pass.uniforms.uRadius!.value   = radius
  pass.uniforms.uStrength!.value = strength
  pass.uniforms.uCoreSize!.value = coreSize
  pass.setCenter                 = (u, v) => {
    (pass.uniforms.uCenter!.value as THREE.Vector2).set(u, v)
  }
  pass.setSize = (width, height) => {
    pass.uniforms.uAspect!.value = width / height
  }
  return pass
}

// perf: low. one tap + arithmetic per pixel.
