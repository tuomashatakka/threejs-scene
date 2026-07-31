import { buildPropDefinition } from './definition.js'
import { PROP_DEFINITIONS } from './presets.js'

import type { Prop } from './prop.js'
import type { PropDefinition } from './definition.js'


export interface PropRegistry {
  register (definition: PropDefinition): PropRegistry
  get (name: string): PropDefinition | undefined
  has (name: string): boolean
  names (): string[]
  definitions (): PropDefinition[]
  create (name: string, options?: Readonly<Record<string, unknown>>): Prop
}

/** Create an explicit, owned synchronous prop registry. */
export function createPropRegistry (
  initial: readonly PropDefinition[] = PROP_DEFINITIONS,
): PropRegistry {
  const definitions            = new Map<string, PropDefinition>()
  const registry: PropRegistry = {
    register (definition) {
      if (definitions.has(definition.name))
        throw new Error(`createPropRegistry: duplicate preset "${definition.name}"`)
      definitions.set(definition.name, definition)
      return registry
    },
    get:         name => definitions.get(name),
    has:         name => definitions.has(name),
    names:       () => [ ...definitions.keys() ],
    definitions: () => [ ...definitions.values() ],
    create (name, options = {}) {
      const definition = definitions.get(name)
      if (!definition)
        throw new Error(`PropRegistry: unknown preset "${name}"`)
      return buildPropDefinition(definition, options)
    },
  }

  for (const definition of initial)
    registry.register(definition)
  return registry
}

// perf: map lookup plus one synchronous procedural build.
