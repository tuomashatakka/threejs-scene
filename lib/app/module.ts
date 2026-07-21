// lib/app/module.ts
// The module contract. A module is a self-contained scene feature in the
// unidirectional flow: `build` creates objects once; `update` projects the
// current state onto them every simulation tick. Modules read state — they
// never write it back.

import type { FrameContext, SceneContext, Size } from '../types'


/**
 * A scene feature in the unidirectional flow. `build` creates objects once;
 * `update` projects the current state onto them every simulation tick;
 * `resize` reacts to viewport changes; `render` optionally takes over the
 * frame's draw; `dispose` tears everything down.
 */
export interface AppModule<S extends object = Record<string, unknown>> {
  name: string

  /** Create objects once and add them to `ctx.scene`. */
  build (ctx: SceneContext): void

  /** Project the current state onto the scene, every simulation tick. */
  update? (state: S, frame: FrameContext, ctx: SceneContext): void

  /** React to viewport size changes (ortho frustums, HUD layout, …). */
  resize? (size: Size, ctx: SceneContext): void

  /**
   * Take over the frame's draw, replacing the default
   * `renderer.render(scene, camera)` — wire an {@link https://threejs.org/docs/#examples/en/postprocessing/EffectComposer | EffectComposer}
   * here. A module that defines `render` becomes a pluggable post-processing
   * layer: drop it into `use: []` and it owns the render, no `AppOptions.render`
   * needed. When several active modules define `render`, the last-mounted one
   * wins; a top-level `AppOptions.render` overrides all of them.
   */
  render? (frame: FrameContext, ctx: SceneContext): void

  /** Tear down everything `build` created. */
  dispose? (): void
}

/** Handle returned by `app.use()`; `remove()` detaches and disposes the module. */
export interface ModuleHandle {
  readonly name: string
  remove (): void
}

/**
 * Identity helper that pins the state generic and gives module literals full
 * type inference — the module-authoring entry point.
 *
 * @example
 * const turbine = defineModule<State>({
 *   name: 'turbine',
 *   build (ctx) { … },
 *   update (state, frame, ctx) { … },
 * })
 */
export function defineModule<S extends object = Record<string, unknown>> (module: AppModule<S>): AppModule<S> {
  return module
}
