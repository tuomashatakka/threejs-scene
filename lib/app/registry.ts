// lib/app/registry.ts
// The module registry — the package's self-description.
//
// Every built-in ships a descriptor: what it is for, what it provides, what it
// requires, and which options it takes, with a subpath to import it from. That
// makes the module set enumerable at runtime instead of discoverable only by
// reading the source, which is the difference between a language model that
// composes this package and one that invents a plausible API for it.
// `scripts/gen-llm-assets.ts` serialises the same registry into
// `llm/modules.json`, so the catalogue an agent reads is the catalogue the code
// actually has.

import { capabilityName } from './capability.js'

import type { CapabilityRef } from './capability.js'
import type { AnyAppModule } from './module.js'


/** One option a module factory accepts, described for a reader that is not human. */
export interface ModuleOption {
  name: string

  /** TypeScript-ish type text: `number`, `Vec3`, `'iso' | 'follow'`. */
  type: string

  /** One line. What it changes, not what it is. */
  summary: string

  /** Rendered as written, e.g. `'1'`, `'[8, 12, 6]'`. */
  default?: string
}

/** A registered module factory, described well enough to be composed sight-unseen. */
export interface ModuleDescriptor<O = never> {

  /** Registry key. Matches the module's `name` for single-instance modules. */
  id: string

  /** Human title, e.g. `'Standard lighting'`. */
  title: string

  /** One or two sentences: what it does and when to reach for it. */
  summary: string

  /** The import path, e.g. `'threejs-scene/modules/lighting'`. */
  subpath: string

  /** The exported factory name, e.g. `'standardLighting'`. */
  factory: string

  provides?: readonly CapabilityRef[]
  requires?: readonly CapabilityRef[]
  optional?: readonly CapabilityRef[]

  /** Free-form grouping for search: `'lighting'`, `'input'`, `'post'`. */
  tags?: readonly string[]

  /** Rough per-frame cost, for budgeting: `'free'`, `'cheap'`, `'medium'`, `'heavy'`. */
  cost?: 'free' | 'cheap' | 'medium' | 'heavy'

  /** Peer dependencies a consumer must install first, e.g. `['cannon-es']`. */
  peers?: readonly string[]

  options?: readonly ModuleOption[]

  /** Build the module. The one call an orchestrator needs. */
  create (options?: O): AnyAppModule
}

const REGISTRY = new Map<string, ModuleDescriptor<never>>()

/**
 * Register a module factory so it can be listed and instantiated by id.
 *
 * Built-ins register themselves when their subpath is imported, so the
 * catalogue always reflects what the consumer actually pulled in.
 *
 * @param descriptor - The module's self-description.
 * @returns The same descriptor, for `export default registerModule({ … })`.
 * @throws Error when `id` is already registered with a different factory.
 */
export function registerModule<O> (descriptor: ModuleDescriptor<O>): ModuleDescriptor<O> {
  const existing = REGISTRY.get(descriptor.id)

  if (existing && existing.create !== descriptor.create as unknown)
    throw new Error(`threejs-scene: module id '${descriptor.id}' is already registered`)

  REGISTRY.set(descriptor.id, descriptor as unknown as ModuleDescriptor<never>)
  return descriptor
}

/** Every registered descriptor, sorted by id so the listing is stable. */
export function listModules (): readonly ModuleDescriptor<never>[] {
  return [ ...REGISTRY.values() ].sort((a, b) => a.id.localeCompare(b.id))
}

/** One descriptor by id, or `undefined`. */
export function findModuleDescriptor (id: string): ModuleDescriptor<never> | undefined {
  return REGISTRY.get(id)
}

/**
 * Instantiate a registered module by id — the entry point for anything driving
 * this package from data rather than from code (a scene file, a tool call).
 *
 * @param id - Registered module id.
 * @param options - Passed straight to the factory.
 * @returns The built module.
 * @throws Error when nothing is registered under `id`.
 */
export function createRegisteredModule<S extends object = Record<string, unknown>> (
  id: string,
  options?: unknown,
): AnyAppModule<S> {
  const descriptor = REGISTRY.get(id)

  if (!descriptor)
    throw new Error(
      `threejs-scene: no module registered as '${id}'. Registered: ${listModules().map(entry => entry.id)
        .join(', ') || '(none — import the module subpath first)'}`,
    )

  return descriptor.create(options as never) as unknown as AnyAppModule<S>
}

/** Which capabilities the registered set covers, and who provides each. */
export function capabilityMap (): Record<string, string[]> {
  const map: Record<string, string[]> = {}

  for (const descriptor of listModules())
    for (const ref of descriptor.provides ?? []) {
      const name = capabilityName(ref)
      map[name]  = [ ...map[name] ?? [], descriptor.id ]
    }

  return map
}

/** The whole registry as plain JSON — what gets written to `llm/modules.json`. */
type ModuleCatalogReturnType = {
  modules:      Record<string, unknown>[]
  capabilities: Record<string, string[]>
}

export function moduleCatalog (): ModuleCatalogReturnType {
  return {
    modules: listModules().map(descriptor => ({
      id:       descriptor.id,
      title:    descriptor.title,
      summary:  descriptor.summary,
      subpath:  descriptor.subpath,
      factory:  descriptor.factory,
      tags:     descriptor.tags ?? [],
      cost:     descriptor.cost ?? 'cheap',
      peers:    descriptor.peers ?? [],
      provides: (descriptor.provides ?? []).map(capabilityName),
      requires: (descriptor.requires ?? []).map(capabilityName),
      optional: (descriptor.optional ?? []).map(capabilityName),
      options:  descriptor.options ?? [],
    })),
    capabilities: capabilityMap(),
  }
}

/** The registry as a markdown table — the form that survives a prompt. */
export function describeModules (): string {
  const rows = listModules().map(descriptor => [
    `\`${descriptor.id}\``,
    descriptor.summary.replace(/\s+/gu, ' '),
    `\`${descriptor.subpath}\``,
    (descriptor.provides ?? []).map(capabilityName).join(', ') || '—',
    (descriptor.requires ?? []).map(capabilityName).join(', ') || '—',
    descriptor.cost ?? 'cheap',
  ].join(' | '))

  return [
    '| module | what it does | import from | provides | requires | cost |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row} |`),
  ].join('\n')
}
