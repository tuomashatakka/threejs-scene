import { buildPropDefinition } from './definition.js'
import { PROP_DEFINITIONS } from './presets.js'
import { buildProp } from './authoring/build.js'
import { validatePropSpec } from './authoring/validate.js'

import type { Prop } from './prop.js'
import type { PropDefinition } from './definition.js'
import type { NormalizedPropSpec, PropSpec } from './authoring/spec.js'
import type { SpecIssue } from './authoring/validate.js'


export interface PropPresetRequest {
  preset:   string
  options?: Readonly<Record<string, unknown>>
}

export type CreatePropInput = string | PropPresetRequest | PropSpec | NormalizedPropSpec | Readonly<Record<string, unknown>> | PropDefinition

export interface CreatePropAttempt {
  ok:     boolean
  prop:   Prop | null
  preset: string | null
  spec:   NormalizedPropSpec | null
  issues: SpecIssue[]
  report: string
}

const builtinDefinitions = new Map(PROP_DEFINITIONS.map(definition => [ definition.name, definition ]))

function isRecord (value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDefinition (value: unknown): value is PropDefinition {
  return isRecord(value) && typeof value.name === 'string' && typeof value.build === 'function'
}

function isPresetRequest (value: unknown): value is PropPresetRequest {
  return isRecord(value) && typeof value.preset === 'string'
}

function presetOptions (value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {}
}

/**
 * One synchronous front door for built-ins, definitions, normalized/raw specs,
 * and model-produced JSON or prose.
 */
export function createProp (
  input: CreatePropInput,
  options: Readonly<Record<string, unknown>> = {},
): Prop {
  if (typeof input === 'string') {
    const exact = builtinDefinitions.get(input)
    if (exact)
      return buildPropDefinition(exact, options)
  }

  if (isDefinition(input))
    return buildPropDefinition(input, options)

  if (isPresetRequest(input)) {
    const definition = builtinDefinitions.get(input.preset)
    if (!definition)
      throw new Error(`createProp: unknown preset "${input.preset}". available: ${[ ...builtinDefinitions.keys() ].join(', ')}`)
    return buildPropDefinition(definition, presetOptions(input.options))
  }

  const review = validatePropSpec(input)
  if (!review.spec)
    throw new Error(`createProp: unusable input\n${review.report}`)
  return buildProp(review.spec, { trusted: true })
}

/** Never-throw form of {@link createProp}, including the validation report. */
export function tryCreateProp (
  input: unknown,
  options: Readonly<Record<string, unknown>> = {},
): CreatePropAttempt {
  try {
    if (typeof input === 'string') {
      const exact = builtinDefinitions.get(input)
      if (exact)
        return { ok: true, prop: buildPropDefinition(exact, options), preset: exact.name, spec: null, issues: [], report: `built preset "${exact.name}"` }
    }

    if (isDefinition(input))
      return { ok: true, prop: buildPropDefinition(input, options), preset: input.name, spec: null, issues: [], report: `built definition "${input.name}"` }

    if (isPresetRequest(input)) {
      const definition = builtinDefinitions.get(input.preset)
      if (!definition) {
        const message = `unknown preset "${input.preset}"`
        return { ok: false, prop: null, preset: input.preset, spec: null, issues: [{ level: 'error', path: 'preset', message }], report: `error preset: ${message}` }
      }
      return {
        ok:     true,
        prop:   buildPropDefinition(definition, presetOptions(input.options)),
        preset: definition.name,
        spec:   null,
        issues: [],
        report: `built preset "${definition.name}"`,
      }
    }

    const review = validatePropSpec(input)
    if (!review.spec)
      return { ...review, prop: null, preset: null }
    return {
      ...review,
      prop:   buildProp(review.spec, { trusted: true }),
      preset: null,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok:     false,
      prop:   null,
      preset: null,
      spec:   null,
      issues: [{ level: 'error', path: '$', message }],
      report: `error $: ${message}`,
    }
  }
}

// perf: exact presets are one map lookup; prose/spec validation is author-time.
