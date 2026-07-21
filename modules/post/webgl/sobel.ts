// lib/post/webgl/sobel.ts
// Sobel edge detection — outlines via the Sobel gradient operator. Wraps three's
// official SobelOperatorShader in a ShaderPass. Mirrors the WebGPU
// `lib/post/webgpu/sobel.ts` effect. The shader reads `tDiffuse` and needs the
// `resolution` uniform set to the render size (update on resize).

import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SobelOperatorShader } from 'three/addons/shaders/SobelOperatorShader.js'


export interface SobelOptions {
  width?:  number
  height?: number
}

export interface SobelPass extends ShaderPass {
  setSize (width: number, height: number): void
}

export function createSobel (options: SobelOptions = {}): SobelPass {
  // Default to the actual drawing-buffer size rather than (1, 1): the gradient
  // kernel steps by 1/resolution, so a (1, 1) default makes the first frame
  // sample a full screen away. Carrying setSize keeps it correct across resizes
  // without the caller having to remember the onResize hook.
  const { width = 1, height = 1 } = options
  const pass                      = new ShaderPass(SobelOperatorShader) as SobelPass
  pass.uniforms.resolution!.value = new THREE.Vector2(width, height)
  pass.setSize                    = (w, h) => {
    (pass.uniforms.resolution!.value as THREE.Vector2).set(w, h)
  }
  return pass
}

// perf: low. Single fullscreen pass, 3x3 luma gradient kernel per fragment.
