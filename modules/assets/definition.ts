import { Prop } from './prop.js'
import { resolveParams } from './params.js'

import type { ParamSpecMap, ParamValue } from './params.js'


export type ResolvedPropOptions = Readonly<Record<string, ParamValue>>

/** Synchronous procedural prop recipe with a serializable option contract. */
export interface PropDefinition {
  readonly name:        string
  readonly description: string
  readonly tags:        readonly string[]
  readonly parameters:  ParamSpecMap
  build (options: ResolvedPropOptions): Prop
}

/** Validate and freeze a procedural prop definition. */
export function defineProp (definition: PropDefinition): PropDefinition {
  if (!definition.name.trim())
    throw new Error('defineProp: `name` is required')
  if (typeof definition.build !== 'function')
    throw new Error(`defineProp("${definition.name}"): \`build\` must be a function`)
  return Object.freeze({
    ...definition,
    tags:       Object.freeze([ ...definition.tags ]),
    parameters: Object.freeze({ ...definition.parameters }),
  })
}

/** Build one definition after forgiving/clamping its untrusted options. */
export function buildPropDefinition (
  definition: PropDefinition,
  options: Readonly<Record<string, unknown>> = {},
): Prop {
  const prop = definition.build(resolveParams(definition.parameters, options))
  if (!(prop instanceof Prop))
    throw new Error(`PropDefinition("${definition.name}") did not return a Prop`)
  return prop
}

// perf: option coercion and one factory call at author time; no frame cost.
