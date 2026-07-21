// lib/post/god-rays-pass.ts
// Volumetric light shafts via screen-space radial scattering toward the light's
// screen-space position. Cheaper than true volumetrics; the light must be in
// front of the camera for the effect to register.
//
// Faithful port of Erkaman/glsl-godrays (index.glsl), itself the classic
// GPU Gems 3 ch.13 / Mitchell light-shaft algorithm. The reference `godrays()`
// returns a PURE ADDITIVE scatter term: it marches from the fragment toward the
// light, accumulating brightness from an occlusion source starting at zero, and
// scales ONLY that accumulation by exposure. We composite it as
// `sceneColor + rays` — the scatter is added on top of the lit scene, never
// folded into it. (The previous implementation seeded the accumulator with the
// base colour and multiplied the whole result by exposure, which darkened and
// double-counted the scene.)
//
// Occlusion source: ideally a masked buffer where only the light/bright emitters
// are non-black and occluders are black (set via `setOcclusionTexture`). With no
// occlusion texture bound it falls back to sampling the scene colour directly,
// which works well when the scene has a bright sun sprite. Ported from
// scripts/god-rays-pass.js.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { FULLSCREEN_VERTEX } from './shared/glsl.js'


const GOD_RAYS_SHADER = {
  uniforms: {
    tDiffuse:      { value: null },
    tOcclusion:    { value: null },
    uHasOcclusion: { value: false },
    uLightPos:     { value: new THREE.Vector2(0.5, 0.7) },
    uExposure:     { value: 0.25 },
    uDecay:        { value: 0.95 },
    uDensity:      { value: 0.9 },
    uWeight:       { value: 0.4 },
    uSamples:      { value: 60 },
    uThreshold:    { value: 0.65 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tOcclusion;
    uniform bool uHasOcclusion;
    uniform vec2 uLightPos;
    uniform float uExposure, uDecay, uDensity, uWeight, uThreshold;
    uniform int uSamples;
    varying vec2 vUv;

    // Bright-pass: isolate the emitters. With no dedicated occlusion buffer the
    // scene colour stands in as the occlusion source, and without this filter
    // EVERY lit surface radiates shafts — the result reads as muddy haze rather
    // than sun shafts. Soft-knee so highlights ramp in instead of popping.
    vec3 brightPass (vec3 c, float threshold) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(threshold, threshold + 0.25, l);
      return c * k;
    }

    // Algorithm from Erkaman/glsl-godrays (GPU Gems 3 ch.13 / Mitchell): march
    // from \`uv\` toward the screen-space light position, accumulating occlusion
    // samples with a decaying weight, then scale the sum by exposure. Returns
    // the scatter term.
    vec3 godrays (
        float density, float weight, float decay, float exposure,
        int numSamples, sampler2D occlusionTexture, bool applyThreshold,
        float threshold, vec2 screenSpaceLightPos, vec2 uv
    ) {
      vec3 fragColor = vec3(0.0, 0.0, 0.0);
      vec2 deltaTextCoord = vec2(uv - screenSpaceLightPos.xy);
      vec2 textCoo = uv.xy;
      deltaTextCoord *= (1.0 / float(numSamples)) * density;
      float illuminationDecay = 1.0;

      // Fixed upper bound (WebGL can't loop a variable number of times); the
      // inner test stops at numSamples. Note \`i >= numSamples\`, not the
      // reference's \`numSamples < i\` — the latter runs numSamples + 1 steps
      // while deltaTextCoord is normalised by 1/numSamples, marching past the light.
      for (int i = 0; i < 100; i++) {
        if (i >= numSamples) break;
        textCoo -= deltaTextCoord;
        vec3 samp = texture2D(occlusionTexture, textCoo).xyz;
        if (applyThreshold) samp = brightPass(samp, threshold);
        samp *= illuminationDecay * weight;
        fragColor += samp;
        illuminationDecay *= decay;
      }

      fragColor *= exposure;
      return fragColor;
    }

    void main () {
      vec4 base = texture2D(tDiffuse, vUv);
      // Branch on a uniform so the one-sampler function can run against either
      // the dedicated occlusion buffer (already masked — no threshold needed) or
      // the scene colour as a fallback (bright-passed so only emitters radiate).
      vec3 rays = uHasOcclusion
        ? godrays(uDensity, uWeight, uDecay, uExposure, uSamples, tOcclusion, false, uThreshold, uLightPos, vUv)
        : godrays(uDensity, uWeight, uDecay, uExposure, uSamples, tDiffuse,   true,  uThreshold, uLightPos, vUv);
      gl_FragColor = vec4(base.rgb + rays, base.a);
    }
  `,
}

const projected = new THREE.Vector3()


/** A {@link ShaderPass} extended with {@link GodRaysPass.updateFromLight} and {@link GodRaysPass.setOcclusionTexture} for per-frame world-space light tracking and optional occlusion-buffer binding. */
export interface GodRaysPass extends ShaderPass {
  // Project a world-space light onto the screen and disable the pass when the
  // light is behind the camera. Call once per frame.
  updateFromLight (lightWorldPos: THREE.Vector3, camera: THREE.Camera): void
  // Bind a dedicated occlusion buffer (black occluders, bright light). Pass null
  // to fall back to using the scene colour as the occlusion source.
  setOcclusionTexture (texture: THREE.Texture | null): void
}

/** Options for {@link createGodRaysPass}. */
export interface GodRaysOptions {

  /**
   * Luminance cutoff for the scene-colour fallback: only pixels brighter than
   * this radiate shafts. Ignored when a dedicated occlusion buffer is bound.
   * Lower it if the sun is dim, raise it if the whole scene hazes over.
   * @defaultValue 0.65
   */
  threshold?: number
}


/**
 * Create a volumetric light-shaft pass using the GPU Gems 3 ch.13 radial-scattering algorithm (Mitchell light-shaft).
 *
 * @returns A {@link GodRaysPass}. Call `updateFromLight(worldPos, camera)` each frame to project a world-space light onto the screen (disables the pass when the light is behind camera). Optionally bind a dedicated occlusion buffer via `setOcclusionTexture(texture)`.
 * @remarks The scatter term is purely additive (sceneColor + rays). Defaults to 60 samples; reduce for mobile. Falls back to sampling the scene colour as the occlusion source when no dedicated buffer is bound.
 */
export function createGodRaysPass (options: GodRaysOptions = {}): GodRaysPass {
  const pass                      = new ShaderPass(GOD_RAYS_SHADER) as GodRaysPass
  pass.uniforms.uThreshold!.value = options.threshold ?? 0.65

  pass.updateFromLight = (lightWorldPos, camera) => {
    projected.copy(lightWorldPos).project(camera);
    (pass.uniforms.uLightPos!.value as THREE.Vector2).set(
      projected.x * 0.5 + 0.5,
      projected.y * 0.5 + 0.5,
    )
    // disable the pass when the light is behind the camera
    pass.enabled = projected.z < 1
  }

  pass.setOcclusionTexture = texture => {
    pass.uniforms.tOcclusion!.value    = texture
    pass.uniforms.uHasOcclusion!.value = texture !== null
  }

  return pass
}

// perf: medium-expensive. Up to uSamples taps per fragment. Reduce uSamples for
// mobile. Defaults are tuned for additive compositing (base.rgb + rays); raise
// uExposure/uWeight for more pronounced shafts, lower them if the light blows out.
