// modules/assets/module.ts
// The procedural content library as a module.
//
// Everything under modules/assets is deliberately a set of pure functions: no
// DOM, no renderer, no lifecycle, so it runs in a headless test and inside a
// server render. That is worth keeping, so this file does not wrap the library
// — it wraps the two things a *scene* needs from it and the pure functions do
// not provide: one place that owns the built objects so they are disposed
// exactly once, and one place the rng is forked from so two modules asking for
// the same prop get the same prop.

import {
  AssetCatalog,
  registerModule,
} from '../../lib/index.js'

import { createPropRegistry } from './registry.js'

import type { AppModule, AssetCatalogApi } from '../../lib/index.js'
import type { PropDefinition } from './definition.js'
import type * as THREE from 'three'


/** Options for {@link assetCatalog}. */
export interface AssetCatalogOptions {

  /**
   * Extra prop definitions on top of the built-in presets. A definition is
   * pure: a name plus a builder that takes options and returns a Prop.
   */
  definitions?: readonly PropDefinition[]

  /**
   * Only these preset names are exposed. Omit to expose everything registered.
   * Naming them keeps a scene's content surface honest — and keeps the bundle
   * from pulling in every preset because the catalogue mentioned them.
   */
  only?: readonly string[]

  /**
   * Default options merged into every `get`, per preset name. Where a scene's
   * house style lives.
   */
  defaults?: Readonly<Record<string, Readonly<Record<string, unknown>>>>

  /**
   * Cache built objects by id and hand the same instance back. Off by default:
   * two props in a scene are usually two objects, and sharing one Object3D
   * between two parents is a bug that renders correctly until it does not.
   * @defaultValue false
   */
  cache?: boolean
}

/**
 * The asset catalogue as an {@link AppModule}, publishing the
 * {@link AssetCatalog} capability: named procedural content, built through one
 * owner so teardown is exactly once, and seeded from one forked stream so the
 * same id yields the same geometry on every run.
 *
 * The objects it builds belong to this module, not to the module that asked
 * for them: `ctx.own` is called on each, so a consumer adds the object to its
 * own root and does not dispose it.
 *
 * @param options - See {@link AssetCatalogOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @example
 * const app = createApp(canvas, {
 *   loop: { fps: 0 },
 *   use:  [ assetCatalog({ only: [ 'crate', 'barrel' ] }) ],
 * })
 *
 * app.use(defineModule({
 *   name:     'yard',
 *   requires: [ AssetCatalog ],
 *   build (ctx) {
 *     const catalog = ctx.resolve(AssetCatalog)
 *     for (const id of catalog.ids)
 *       ctx.root.add(catalog.get(id))
 *   },
 * }))
 */
export function assetCatalog<S extends object = Record<string, unknown>> (
  options: AssetCatalogOptions = {},
): AppModule<S> {
  return {
    name:     'assets',
    provides: [ AssetCatalog ],

    // content exists before the modules that place it
    order: -60,

    build (ctx) {
      const registry = createPropRegistry()

      for (const definition of options.definitions ?? [])
        registry.register(definition)

      const exposed = options.only
        ? options.only.filter(name => registry.has(name))
        : registry.names()

      if (options.only)
        for (const name of options.only)
          if (!registry.has(name))
            ctx.violation('SC009', `catalog: no prop preset named '${name}'`)

      const cache = new Map<string, THREE.Object3D>()

      ctx.provide(AssetCatalog, {
        ids: exposed,
        has: id => exposed.includes(id),
        get (id) {
          const held = options.cache ? cache.get(id) : undefined

          if (held)
            return held

          if (!exposed.includes(id))
            throw new Error(`AssetCatalog: '${id}' is not exposed. Available: ${exposed.join(', ')}`)

          // one fork per id, so adding a preset cannot reshuffle the others
          const built = registry.create(id, {
            rng: ctx.rng.fork(id),
            ...options.defaults?.[id],
          }) as unknown as THREE.Object3D

          // the catalogue owns what it builds; consumers only parent it
          ctx.own(built)

          if (options.cache)
            cache.set(id, built)

          return built
        },
      } satisfies AssetCatalogApi)

      ctx.onCleanup(() => cache.clear())
    },
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'assets',
  title: 'Asset catalogue',
  summary:
    'Named procedural props, built through one owner so teardown happens exactly once, and seeded from one ' +
    'fork-per-id stream so the same id yields the same geometry on every run. DOM-free and SSR-safe.',
  subpath:  'threejs-scene/modules/assets',
  factory:  'assetCatalog',
  tags:     [ 'assets', 'content' ],
  cost:     'cheap',
  provides: [ AssetCatalog ],
  options:  [
    { name: 'definitions', type: 'PropDefinition[]', summary: 'extra prop definitions on top of the built-in presets' },
    { name: 'only', type: 'string[]', summary: 'expose only these preset names' },
    { name: 'defaults', type: 'Record<string, object>', summary: 'per-preset option defaults — where a scene house style lives' },
    { name: 'cache', type: 'boolean', summary: 'hand the same instance back for the same id; off because two props are usually two objects', default: 'false' },
  ],
  create: (options?: AssetCatalogOptions) => assetCatalog(options),
})

// perf: cheap. one synchronous procedural build per distinct id.
