/** Serializable parameter contracts for presets and model-produced options. */
export type ParamSpec =
  | { kind: 'number', default: number, min?: number, max?: number, description?: string } |
  { kind: 'int', default: number, min?: number, max?: number, description?: string } |
  { kind: 'boolean', default: boolean, description?: string } |
  { kind: 'string', default: string, description?: string } |
  { kind: 'enum', default: string, options: readonly string[], description?: string }

export type ParamSpecMap = Readonly<Record<string, ParamSpec>>
export type ParamValue = string | number | boolean

function clamp (value: number, minimum?: number, maximum?: number): number {
  let result = value
  if (minimum !== undefined)
    result = Math.max(minimum, result)
  if (maximum !== undefined)
    result = Math.min(maximum, result)
  return result
}

/** Coerce one untrusted value to a declared parameter. Never throws. */
export function resolveParam (spec: ParamSpec, given: unknown): ParamValue {
  switch (spec.kind) {
    case 'number': {
      const value = typeof given === 'number' && Number.isFinite(given) ? given : spec.default
      return clamp(value, spec.min, spec.max)
    }
    case 'int': {
      const value = typeof given === 'number' && Number.isFinite(given) ? Math.round(given) : spec.default
      return clamp(value, spec.min, spec.max)
    }
    case 'boolean':
      return typeof given === 'boolean' ? given : spec.default
    case 'string':
      return typeof given === 'string' ? given : spec.default
    case 'enum':
      return typeof given === 'string' && spec.options.includes(given) ? given : spec.default
  }
}

/** Coerce a whole options object, clamping values and ignoring unknown keys. */
export function resolveParams (
  specs: ParamSpecMap,
  given: Readonly<Record<string, unknown>> = {},
): Record<string, ParamValue> {
  const result: Record<string, ParamValue> = {}
  for (const [ name, spec ] of Object.entries(specs))
    result[name] = resolveParam(spec, given[name])
  return result
}

// perf: one author-time pass over a small option map; no frame cost.
