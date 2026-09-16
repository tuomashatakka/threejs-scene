// lib/app/plugin.ts
// A plugin is a named bundle of modules — the unit you ship when a feature is
// three modules that only make sense together (a camera rig, its input, and the
// post chain that assumes both). `createApp` flattens plugins ahead of `use`,
// and because ordering is decided by declared capabilities rather than by
// position, a plugin's modules land wherever their dependencies put them.

import type { CapabilityRef } from './capability.js'
import type { AnyAppModule } from './module.js'


/**
 * A named bundle of modules.
 *
 * @typeParam S - App state shape the bundled modules read.
 */
export interface Plugin<S extends object = Record<string, unknown>> {

  /** Bundle name, used in diagnostics. */
  name: string

  /** One line: what the bundle is for. */
  summary?: string

  /** Semver of the plugin itself, when it ships separately. */
  version?: string

  /** The modules, in authoring order. Resolved order still comes from capabilities. */
  use: readonly AnyAppModule<S>[]

  /** Capabilities the bundle as a whole publishes — documentation, not enforcement. */
  provides?: readonly CapabilityRef[]

  /** Capabilities the bundle expects the host app to already provide. */
  requires?: readonly CapabilityRef[]
}

/** A plugin, or a factory that makes one — both accepted by `AppOptions.plugins`. */
export type PluginInput<S extends object = Record<string, unknown>> = Plugin<S> | (() => Plugin<S>)

/**
 * Identity helper that pins the state generic for a plugin literal.
 *
 * @param plugin - The bundle.
 * @returns The same object, typed.
 * @typeParam S - App state shape.
 * @example
 * export const isometricKit = definePlugin<State>({
 *   name: 'isometric-kit',
 *   use:  [ cameraRig({ kind: 'iso' }), pointerInput(), standardLighting() ],
 * })
 */
export function definePlugin<S extends object = Record<string, unknown>> (plugin: Plugin<S>): Plugin<S> {
  return plugin
}

/**
 * Flatten plugins into the module list, in plugin order then module order.
 *
 * @param plugins - Plugins or plugin factories.
 * @returns Every module the plugins contribute.
 */
export function flattenPlugins<S extends object> (plugins: readonly PluginInput<S>[] | undefined): AnyAppModule<S>[] {
  return (plugins ?? []).flatMap(input => {
    const plugin = typeof input === 'function' ? input() : input
    return [ ...plugin.use ]
  })
}
