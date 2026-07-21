// lib/post/glitch-passes.ts
// Three discrete glitch ShaderPass factories. Stack them with separate
// intensity uniforms for layered datamosh. Ported from scripts/glitch-passes.js.

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { FULLSCREEN_VERTEX, GLSL_HASH, GLSL_CHROMATIC } from './shared/glsl.js'


const RGB_SHIFT_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uIntensity: { value: 0.5 },
    uAngle:     { value: 0.0 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity, uAngle;
    varying vec2 vUv;
    ${GLSL_CHROMATIC}
    void main () {
      vec2 off = vec2(cos(uAngle), sin(uAngle)) * (0.005 * uIntensity);
      gl_FragColor = vec4(chromaticSample(tDiffuse, vUv, off), texture2D(tDiffuse, vUv).a);
    }
  `,
}

const BLOCK_DISPLACEMENT_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uIntensity: { value: 0.5 },
    uBlockSize: { value: 32.0 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity, uBlockSize;
    varying vec2 vUv;
    ${GLSL_HASH}
    void main () {
      vec2 res = vec2(uBlockSize);
      vec2 block = floor(vUv * res) / res;
      float h = hash21(block + floor(uTime * 12.0));
      float threshold = 1.0 - uIntensity * 0.4;
      vec2 shift = vec2(0.0);
      if (h > threshold) shift.x = (h - threshold) * 0.3 * sign(h - 0.5);
      vec4 c = texture2D(tDiffuse, vUv + shift);
      if (h > threshold + 0.05) c.rgb = c.bgr;
      gl_FragColor = c;
    }
  `,
}

const SCAN_CORRUPTION_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uIntensity: { value: 0.5 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity;
    varying vec2 vUv;
    void main () {
      float band = step(0.98, fract(vUv.y * 80.0 + uTime * 2.0));
      float jitter = (band > 0.5) ? (sin(uTime * 30.0 + vUv.y * 100.0) * 0.02 * uIntensity) : 0.0;
      vec4 c = texture2D(tDiffuse, vec2(vUv.x + jitter, vUv.y));
      c.rgb += band * uIntensity * 0.4;
      gl_FragColor = c;
    }
  `,
}


/**
 * Create a glitch pass that separates the RGB channels along a configurable angle.
 *
 * @returns A {@link ShaderPass} whose `uIntensity` (default `0.5`) and `uAngle` uniforms control the shift magnitude and direction.
 * @remarks Use together with {@link createBlockDisplacementPass} and {@link createScanCorruptionPass} for a layered datamosh effect.
 */
export function createRgbShiftPass (): ShaderPass {
  return new ShaderPass(RGB_SHIFT_SHADER)
}


/**
 * Create a glitch pass that displaces and swaps colour channels in pseudo-random blocks.
 *
 * @returns A {@link ShaderPass} whose `uIntensity` (default `0.5`) and `uBlockSize` (default `32`) uniforms control the block corruption.
 * @remarks Each block selects a random horizontal shift and optionally swaps the R and B channels.
 */
export function createBlockDisplacementPass (): ShaderPass {
  return new ShaderPass(BLOCK_DISPLACEMENT_SHADER)
}


/**
 * Create a glitch pass that adds horizontal scan-line jitter and brightness spikes.
 *
 * @returns A {@link ShaderPass} whose `uIntensity` (default `0.5`) uniform controls the corruption amplitude.
 * @remarks Bands sweep vertically at 2x time frequency; within each band the output is horizontally jittered and brightened.
 */
export function createScanCorruptionPass (): ShaderPass {
  return new ShaderPass(SCAN_CORRUPTION_SHADER)
}

// perf: medium. Each pass is one fullscreen fragment shader. Disable on mobile
// or gate behind a "stylized" quality flag.
