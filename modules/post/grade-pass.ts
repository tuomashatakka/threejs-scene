// lib/post/grade-pass.ts
// Colour grade pass. Per production-lessons.md the canonical chain is
// RenderPass → UnrealBloomPass → ShaderPass(grade) → OutputPass, with the grade
// running in linear HDR (scene-referred), BEFORE tone-mapping. It applies tint,
// contrast around mid-grey, saturation, a soft radial vignette, seeded grain,
// and radial chromatic aberration that grows toward the corners
// (split ∝ dot(centerOffset, centerOffset)). Tone-map exactly once, at the
// OutputPass — do NOT also set renderer.toneMapping.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { FULLSCREEN_VERTEX, GLSL_CHROMATIC, GLSL_VIGNETTE, GLSL_GRAIN } from './shared/glsl.js'


/** Raw shader definition for the colour-grade pass: tint, contrast, saturation, vignette, seeded grain, and radial chromatic aberration operating in linear HDR space. */
export const GradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uTint:       { value: new THREE.Color('#ffffff') },
    uContrast:   { value: 1.05 },
    uSaturation: { value: 1.1 },
    uVignette:   { value: 0.35 },
    uGrain:      { value: 0 },
    uChromatic:  { value: 0 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uContrast, uSaturation, uVignette, uGrain, uChromatic;
    uniform vec3 uTint;
    varying vec2 vUv;
    ${GLSL_CHROMATIC}
    ${GLSL_VIGNETTE}
    ${GLSL_GRAIN}
    void main () {
      vec2 center = vUv - 0.5;
      // Radial chromatic aberration: split grows toward the corners. Off by
      // default — createChromaticAberration() is the dedicated pass; leaving it
      // on here double-applied CA whenever both were enabled.
      float split = dot(center, center) * uChromatic * 0.02;
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = uChromatic > 0.0 ? chromaticSample(tDiffuse, vUv, center * split) : src.rgb;

      // grade in linear HDR, before tone-mapping
      col *= uTint;
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSaturation);

      // soft radial vignette
      col *= vignette(vUv, uVignette);

      // seeded grain — off by default; createFilmGrainPass() is the dedicated pass
      col += grain(vUv, uTime, uGrain);

      gl_FragColor = vec4(col, src.a);
    }
  `,
}


/** Options for {@link createGradePass}: tint colour, contrast, saturation, vignette, grain, and chromatic-aberration strength. */
export interface GradePassOptions {
  tint?:       THREE.ColorRepresentation
  contrast?:   number
  saturation?: number
  vignette?:   number
  grain?:      number
  chromatic?:  number
}

/** Colour-grade pass with a setTime() method to animate seeded grain. */
export interface GradePass extends ShaderPass {
  setTime (elapsed: number): void
}


/**
 * Create a colour-grade pass that applies tint, contrast, saturation, vignette, seeded grain, and radial chromatic aberration in linear HDR.
 *
 * @param options.tint - Colour tint as a {@link THREE.ColorRepresentation}. Default `#ffffff`.
 * @param options.contrast - S-curve contrast pivot about mid-grey. Default `1.05`.
 * @param options.saturation - Colour saturation multiplier. Default `1.1`.
 * @param options.vignette - Soft radial vignette strength. Default `0.35`.
 * @param options.grain - Seeded grain amplitude. Default `0` — use {@link createFilmGrainPass} instead unless you specifically want grain applied pre-tone-map.
 * @param options.chromatic - Radial chromatic-aberration strength that grows toward the corners. Default `0` — use `createChromaticAberration` instead.
 * @returns A {@link GradePass} whose `setTime(elapsed)` updates the grain seed each frame.
 * @remarks Must run in linear HDR (scene-referred) BEFORE the OutputPass tone-maps. Do NOT also set `renderer.toneMapping`. Grain and CA default to 0 so stacking this with the dedicated grain/CA passes does not double-apply either.
 */
export function createGradePass ({
  tint = '#ffffff',
  contrast = 1.05,
  saturation = 1.1,
  vignette = 0.35,
  grain = 0,
  chromatic = 0,
}: GradePassOptions = {}): GradePass {
  const pass                       = new ShaderPass(GradeShader) as GradePass
  pass.uniforms.uTint!.value       = new THREE.Color(tint)
  pass.uniforms.uContrast!.value   = contrast
  pass.uniforms.uSaturation!.value = saturation
  pass.uniforms.uVignette!.value   = vignette
  pass.uniforms.uGrain!.value      = grain
  pass.uniforms.uChromatic!.value  = chromatic

  pass.setTime = elapsed => {
    pass.uniforms.uTime!.value = elapsed
  }

  return pass
}

// perf: cheap-medium. one fullscreen pass; 3 texture taps for the CA split.
