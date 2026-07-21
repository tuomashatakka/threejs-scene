// lib/post/hud-beam-transition.ts
// Horizontal phase-in transition. A luminous beam sweeps left→right, revealing
// content with RGB-split fringes. Midpoint callback fires the exact frame the
// beam crosses 0.5 — swap content there so the beam masks the cut. Ported from
// scripts/hud-beam-transition.js.

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

import { FULLSCREEN_VERTEX, GLSL_HASH, GLSL_CHROMATIC } from './shared/glsl.js'


const HUD_BEAM_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    uProgress:  { value: 0 },
    uBeamWidth: { value: 0.08 },
    uBeamColor: { value: new THREE.Color('#79f7ff') },
    uFringe:    { value: 0.02 },
    uNoiseAmp:  { value: 0.01 },
    uTime:      { value: 0 },
  },
  vertexShader:   FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uProgress, uBeamWidth, uFringe, uNoiseAmp, uTime;
    uniform vec3 uBeamColor;
    varying vec2 vUv;
    ${GLSL_HASH}
    ${GLSL_CHROMATIC}
    void main () {
      float beamX = uProgress;
      float dist = vUv.x - beamX;
      float beam = exp(-pow(dist / uBeamWidth, 2.0));
      float reveal = step(0.0, -dist);
      float fringeOffset = beam * uFringe;
      float noise = (hash21(vUv * 256.0 + uTime) - 0.5) * uNoiseAmp * beam;
      vec2 uv = vUv + vec2(noise, 0.0);
      vec3 base = chromaticSample(tDiffuse, uv, vec2(fringeOffset, 0.0)) * reveal;
      vec3 glow = uBeamColor * beam * 1.4;
      gl_FragColor = vec4(base + glow, 1.0);
    }
  `,
}


/** Options for {@link createHudBeamTransition}: sweep duration, beam width, beam tint colour, and completion callback. */
export interface HudBeamOptions {
  duration?:   number
  beamWidth?:  number
  beamColor?:  THREE.ColorRepresentation
  onComplete?: () => void
}


/** Handle returned by {@link createHudBeamTransition}; controls a horizontal beam-sweep transition via {@link HudBeamTransition.play} and {@link HudBeamTransition.tick}. */
export interface HudBeamTransition {
  pass: ShaderPass
  play (onMidpoint?: () => void): void
  tick (delta: number, time: number): void
}


/**
 * Create a horizontal beam-sweep transition that reveals content beneath an RGB-split luminous beam.
 *
 * @param options.duration - Sweep duration in seconds. Default `0.9`.
 * @param options.beamWidth - Width of the luminous beam as a fraction of screen width. Default `0.08`.
 * @param options.beamColor - Beam tint colour. Default `#79f7ff`.
 * @param options.onComplete - Callback fired when the sweep reaches completion (progress >= 1).
 * @returns A {@link HudBeamTransition}. Call `play(onMidpoint?)` to start the sweep; call `tick(delta, time)` each frame to advance. The `onMidpoint` fires when progress crosses 0.5 — the ideal frame to swap content.
 * @remarks The beam masks the cut at its midpoint, making it suitable for reveal transitions. Disabled (pass.enabled = false) when not playing, adding zero rendering cost.
 */
export function createHudBeamTransition ({
  duration = 0.9,
  beamWidth = 0.08,
  beamColor = '#79f7ff',
  onComplete,
}: HudBeamOptions = {}): HudBeamTransition {
  const pass                      = new ShaderPass(HUD_BEAM_SHADER)
  pass.uniforms.uBeamWidth!.value = beamWidth
  pass.uniforms.uBeamColor!.value = new THREE.Color(beamColor)
  pass.enabled                    = false

  let elapsed                    = 0
  let running                    = false
  let halfFired                  = false
  let onMid: (() => void) | null = null

  function play (onMidpoint?: () => void): void {
    elapsed = 0
    running = true
    halfFired = false
    pass.enabled = true
    onMid = onMidpoint ?? null
  }

  function tick (delta: number, time: number): void {
    pass.uniforms.uTime!.value = time
    if (!running)
      return
    elapsed += delta

    const progress                 = Math.min(elapsed / duration, 1)
    pass.uniforms.uProgress!.value = progress
    if (!halfFired && progress >= 0.5) {
      halfFired = true
      onMid?.()
    }
    if (progress >= 1) {
      running = false
      pass.enabled = false
      onComplete?.()
    }
  }

  return { pass, play, tick }
}

// perf: cheap when disabled (gated by pass.enabled). Medium during playback.
