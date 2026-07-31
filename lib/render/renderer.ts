// lib/render/renderer.ts
// WebGLRenderer factory. Caps pixel ratio at 2, sets sane defaults for color
// space, tone mapping, and shadows.

import * as THREE from 'three'


/** Options for {@link createRenderer}. */
export interface RendererOptions {
  canvas: HTMLCanvasElement

  /** @defaultValue true */
  antialias?: boolean

  /**
   * Upper bound applied to `window.devicePixelRatio`.
   * @defaultValue 2
   */
  pixelRatioMax?: number

  /**
   * Enable PCF shadow maps.
   * @defaultValue true
   */
  shadows?: boolean

  /** @defaultValue THREE.ACESFilmicToneMapping */
  toneMapping?: THREE.ToneMapping

  /** @defaultValue 1 */
  toneMappingExposure?: number

  /** For scenes spanning huge depth ranges (space scale -> surface scale). */
  logarithmicDepthBuffer?: boolean
}

/**
 * Create a `WebGLRenderer` with production defaults: high-performance power
 * preference, sRGB output, ACES filmic tone mapping, PCF shadows, and
 * pixel ratio capped at 2. The renderer is sized to the canvas parent element
 * (falling back to `document.body`) without touching the canvas CSS size.
 *
 * @param options - Canvas plus overrides; see {@link RendererOptions}.
 * @returns The configured renderer. Create one per scene and never recreate it
 * per frame; call `dispose()` on teardown.
 */
export function createRenderer ({
  canvas,
  antialias = true,
  pixelRatioMax = 2,
  shadows = true,
  toneMapping = THREE.ACESFilmicToneMapping,
  toneMappingExposure = 1,
  logarithmicDepthBuffer = false,
}: RendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias,
    alpha:           false,
    powerPreference: 'high-performance',
    stencil:         false,
    logarithmicDepthBuffer,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioMax))

  const parent = canvas.parentElement ?? document.body
  renderer.setSize(parent.clientWidth, parent.clientHeight, false)

  renderer.outputColorSpace    = THREE.SRGBColorSpace
  renderer.toneMapping         = toneMapping
  renderer.toneMappingExposure = toneMappingExposure

  if (shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type    = THREE.PCFShadowMap
  }

  return renderer
}

// perf: cheap. one renderer instance per scene, never recreated.
