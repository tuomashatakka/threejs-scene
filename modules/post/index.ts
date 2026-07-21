// modules/post/index.ts
// Post-processing as a pluggable app module — the same contract as
// standardLighting()/orbitControls(). Drop postProcessing() into `use: []`
// (or app.use()) and it owns the frame draw through the module `render` hook:
// it builds an EffectComposer in `build`, resizes it in `resize`, renders it in
// `render`, and tears it down in `dispose`. No AppOptions.render wiring needed.
//
// This index also re-exports the composition layer (composer) and the standalone
// custom-GLSL passes that are actually used (grade, glitch, god-rays, film-grain,
// cinematic-lut). The full WebGL effect catalogue (bloom, ca, crt, pixel, …) lives
// one level down — import it from `.../modules/post/webgl` (barrel: ./webgl/index).
// Shared GLSL chunks live in ./shared/glsl.
//
// WebGL only. WebGPU/TSL is out of scope.

import * as THREE from 'three'

import { createComposer } from './composer.js'

import type { AppModule, SceneContext, FrameContext, Size } from '../../lib/index'
import type { ComposerHandle } from './composer.js'
import type { WebGlPassContext, Resizable, Pass } from './webgl/types.js'


/**
 * Context handed to {@link PostProcessingOptions.effects}: the usual
 * {@link WebGlPassContext} plus the live composer and its shared depth texture,
 * so depth-sampling passes (motion blur, god rays) can bind depth without the
 * caller ever touching the composer directly.
 */
export interface EffectContext extends WebGlPassContext {
  composer:     ComposerHandle['composer']
  depthTexture: THREE.Texture | null
}


/** UnrealBloom settings for the base chain; see {@link createComposer}. */
export interface PostProcessingBloom {

  /** Bloom intensity. @defaultValue 0.7 */
  strength?: number

  /** Bloom spread. @defaultValue 0.4 */
  radius?: number

  /** Luminance threshold for blooming. @defaultValue 0.85 */
  threshold?: number
}

/** Options for {@link postProcessing}. */
export interface PostProcessingOptions {

  /**
   * UnrealBloom in the base chain, or `false` to omit it. An empty object keeps
   * the composer defaults.
   * @defaultValue `{}` (bloom on, default strength/radius/threshold)
   */
  bloom?: PostProcessingBloom | false

  /**
   * Attach a shared depth texture to the composer's render targets. Required by
   * depth-sampling passes (DOF, god rays, motion blur).
   * @defaultValue false
   */
  depth?: boolean

  /**
   * Build the custom passes to insert before tone-mapping. Receives an
   * {@link EffectContext} (renderer/scene/camera + current pixel size, plus the
   * composer and its depth texture); return the passes in the order they should
   * run. Each is added via the composer's `addPassBeforeOutput`, so OutputPass
   * always stays last.
   */
  effects?: (ctx: EffectContext) => Pass[]

  /**
   * Per-tick hook to drive time/camera-dependent uniforms on the passes you
   * created in {@link PostProcessingOptions.effects} (e.g. `grade.setTime`,
   * `crt.tick`, `motionBlur.update`). Runs inside the module's `update`, so it
   * follows the same unidirectional rule — read state, write uniforms, never
   * touch the store.
   */
  onFrame?: (frame: FrameContext, ctx: SceneContext) => void

  /**
   * Per-resize hook, symmetric with {@link PostProcessingOptions.onFrame}. Runs
   * after the composer and any `setSize`-carrying passes have been resized, for
   * passes that track resolution through a plain uniform instead (e.g. sobel's
   * `resolution`).
   */
  onResize?: (size: Size, ctx: SceneContext) => void
}

/**
 * Post-processing rig as an {@link AppModule}. Builds an EffectComposer
 * (RenderPass → optional UnrealBloom → your passes → OutputPass, tone-mapped
 * once at OutputPass) and takes over the app's render via the module `render`
 * hook — making it a genuine drop-in, exactly like the lighting/orbit modules.
 *
 * @param options - See {@link PostProcessingOptions}.
 * @returns An {@link AppModule}. Add it with `use: []` or `app.use()`; remove it
 * with the returned handle to restore the default `renderer.render`.
 * @typeParam S - Serializable app state shape (unused here, kept for `use: []` inference).
 * @example
 * import { postProcessing } from '@tuomashatakka/threejs-scene/modules/post'
 * import { createChromaticAberration } from '@tuomashatakka/threejs-scene/modules/post/webgl/ca'
 *
 * const app = createApp(canvas, {
 *   use: [
 *     standardLighting(),
 *     postProcessing({
 *       bloom:   { strength: 0.8 },
 *       effects: () => [ createChromaticAberration({ strength: 1.2 }) ],
 *     }),
 *   ],
 * })
 * app.start()
 */
export function postProcessing<S extends object = Record<string, unknown>> (
  options: PostProcessingOptions = {},
): AppModule<S> {
  const { bloom = {}, depth = false, effects, onFrame, onResize } = options
  const bloomOpts                                                 = bloom === false ? undefined : bloom

  let handle: ComposerHandle | null = null
  let passes: Pass[]                = []

  return {
    name: 'postprocessing',

    build (ctx: SceneContext) {
      const size   = ctx.renderer.getSize(new THREE.Vector2())
      const width  = size.x || 1
      const height = size.y || 1

      handle = createComposer({
        renderer:       ctx.renderer,
        scene:          ctx.scene,
        camera:         ctx.camera,
        width,
        height,
        withDepth:      depth,
        withBloom:      bloom !== false,
        bloomStrength:  bloomOpts?.strength,
        bloomRadius:    bloomOpts?.radius,
        bloomThreshold: bloomOpts?.threshold,
      })

      if (effects) {
        passes = effects({
          renderer:     ctx.renderer,
          scene:        ctx.scene,
          camera:       ctx.camera,
          width,
          height,
          composer:     handle.composer,
          depthTexture: handle.composer.renderTarget1.depthTexture ?? null,
        })
        for (const pass of passes)
          handle.addPassBeforeOutput(pass)
      }
    },

    update (_state: S, frame: FrameContext, ctx: SceneContext) {
      onFrame?.(frame, ctx)
    },

    resize (size, ctx) {
      handle?.setSize(size.width, size.height)
      // resolution-dependent passes carry their own setSize (see Resizable)
      for (const pass of passes)
        (pass as Partial<Resizable>).setSize?.(size.width, size.height)
      onResize?.(size, ctx)
    },

    render (frame: FrameContext) {
      handle?.composer.render(frame.delta)
    },

    dispose () {
      for (const pass of passes)
        (pass as { dispose?: () => void }).dispose?.()
      handle?.bloom?.dispose()
      handle?.dispose()
      handle = null
      passes = []
    },
  }
}

// perf: one composer render per frame = N fullscreen passes. Bloom + any
// depth-sampling pass dominate; gate heavy effects behind a quality tier.

// ── Re-exports: only the actually-used composition layer + standalone passes.
// Dead factories (pipeline, dof-chromatic) are gone; stereoscopy / hud-beam
// stay reachable via their own subpaths but are not surfaced here.
export * from './composer.js'
export * from './shared/glsl.js'
export * from './grade-pass.js'
export * from './glitch-passes.js'
export * from './god-rays-pass.js'
export * from './film-grain-pass.js'
export * from './cinematic-lut.js'
