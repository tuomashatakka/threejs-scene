// modules/authoring/tool.ts
// The tool surface, and the loop that makes a small model good at this.
//
// `createPropTool()` is provider-agnostic on purpose: it hands back a name, a
// description, a JSON Schema and a `run` — the four things every function
// calling API asks for, under whatever names it uses. No SDK is imported, so
// this file works against Anthropic, OpenAI, Gemini, ai-sdk, llama.cpp grammars,
// or a plain fetch to a local Ollama.
//
// `generateProp()` is the part that actually matters. One shot from a 3B model
// is a coin flip; the same model, told "the seat floats 0.4m above the legs",
// fixes it on the second turn. The loop is only worth writing once, so it lives
// here rather than in every consumer.

import { buildProp, tryBuildProp } from './build.js'
import { reviewProp } from './review.js'
import { PROP_SPEC_SCHEMA } from './schema.js'
import { propAuthoringPrompt, propRetryPrompt } from './prompt.js'
import { validatePropSpec } from './validate.js'

import type { Prop } from '../assets/index.js'
import type { NormalizedPropSpec } from './spec.js'
import type { JsonSchema } from './schema.js'
import type { PromptOptions } from './prompt.js'
import type { PropReview } from './review.js'
import type { SpecIssue } from './validate.js'


/** What one call to {@link PropTool.run} produced. */
export interface PropToolResult {

  /** True when a prop was built. */
  ok: boolean

  /** The normalized spec, or `null` when validation failed. */
  spec: NormalizedPropSpec | null

  /** The built prop, or `null`. The caller owns it — `dispose()` it. */
  prop: Prop | null

  /** Validation errors and repairs. */
  issues: SpecIssue[]

  /** Measurements and critique, when something was built. */
  review: PropReview | null

  /** The text to hand back to the model as the tool result. */
  report: string
}

/** A provider-agnostic tool definition. */
export interface PropTool {

  /** Tool name to expose to the model. */
  name: string

  /** Tool description — what the model reads when deciding to call it. */
  description: string

  /**
   * JSON Schema for the arguments. Feed it to whichever field your provider
   * calls it: `input_schema`, `parameters`, `parametersJsonSchema`.
   */
  inputSchema: JsonSchema

  /**
   * Execute a call. Never throws — a broken argument comes back as a report
   * the model can act on.
   */
  run (input: unknown): PropToolResult
}

/** Options for {@link createPropTool}. */
export interface CreatePropToolOptions {

  /** Tool name. @defaultValue `'create_prop'` */
  name?: string

  /** Also critique the built geometry and include it in the report. @defaultValue true */
  review?: boolean
}

const TOOL_DESCRIPTION = 'Build a small 3D prop out of simple shapes. ' +
  'Units are metres, y is up, the ground is y = 0, and "at" is the centre of each part. ' +
  'Returns the prop\'s measurements, or what is wrong with it so you can try again.'

/**
 * Define the prop-building tool for a model to call.
 *
 * @returns A {@link PropTool} — name, description, schema, and a `run` that
 * validates, builds, and critiques.
 * @example
 * const tool = createPropTool()
 * // Anthropic: { name: tool.name, description: tool.description, input_schema: tool.inputSchema }
 * const result = tool.run(JSON.parse(toolUse.input))
 * if (result.prop) scene.add(result.prop)
 */
export function createPropTool ({ name = 'create_prop', review = true }: CreatePropToolOptions = {}): PropTool {
  return {
    name,
    description: TOOL_DESCRIPTION,
    inputSchema: PROP_SPEC_SCHEMA,
    run (input: unknown): PropToolResult {
      const attempt = tryBuildProp(input)
      if (!attempt.prop)
        return { ok: false, spec: null, prop: null, issues: attempt.issues, review: null, report: attempt.report }

      const critique = review ? reviewProp(attempt.prop) : null
      const warnings = attempt.issues.length > 0 ? attempt.report : ''

      return {
        ok:     true,
        spec:   attempt.spec,
        prop:   attempt.prop,
        issues: attempt.issues,
        review: critique,
        report: [ warnings, critique?.report ?? 'built' ].filter(Boolean).join('\n'),
      }
    },
  }
}

/** One request to the model. Whatever calls it decides how to reach the model. */
export interface PropCompletionRequest {

  /** System prompt: the grammar, vocabulary and examples. Constant across turns. */
  system: string

  /** The turn's user message — the brief, or the correction. */
  prompt: string

  /** 1 for the first try. */
  attempt: number
}

/** Your model call. Return the model's raw text; the loop finds the JSON in it. */
export type PropCompletion = (request: PropCompletionRequest) => Promise<string> | string

/** Options for {@link generateProp}. */
export interface GeneratePropOptions {

  /** What to build, in plain language. */
  brief: string

  /** How to reach the model. */
  complete: PropCompletion

  /** Maximum model turns, including the first. @defaultValue 3 */
  attempts?: number

  /**
   * Keep retrying while the critic has notes, not just on hard errors. Turn it
   * off for props that are meant to float or come apart.
   * @defaultValue true
   */
  fixNotes?: boolean

  /** Passed to {@link propAuthoringPrompt} when no `system` is given. */
  prompt?: PromptOptions

  /** Override the system prompt entirely. */
  system?: string
}

/** What {@link generateProp} came back with. */
export interface PropGeneration extends PropToolResult {

  /** How many model turns it took. */
  attempts: number

  /** Every raw model response, in order — for logging and eval. */
  transcript: string[]
}

/**
 * Ask a model for a prop, then hold it to the result.
 *
 * Sends the brief, parses whatever comes back, builds it, critiques it, and
 * feeds any problems back for another turn — up to `attempts`. Returns the best
 * attempt: a clean prop if one appeared, otherwise the one with the fewest
 * complaints. Props from discarded attempts are disposed on the way past.
 *
 * @returns The winning {@link PropToolResult}, plus the turn count and every
 * raw response.
 * @example
 * const result = await generateProp({
 *   brief:    'a mossy stone well',
 *   attempts: 3,
 *   complete: async ({ system, prompt }) => callYourModel(system, prompt),
 * })
 * if (result.prop) scene.add(result.prop)
 */
export async function generateProp (options: GeneratePropOptions): Promise<PropGeneration> {
  const { brief, complete, attempts = 3, fixNotes = true } = options
  const system                                             = options.system ?? propAuthoringPrompt(options.prompt)
  const transcript: string[]                               = []

  let best: PropToolResult | null = null
  let prompt                      = `Build: ${brief}`

  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    const text = await complete({ system, prompt, attempt })
    transcript.push(text)

    const result = createPropTool().run(text)
    const clean  = result.ok && (result.review?.notes.length ?? 0) === 0

    if (clean || attempt === Math.max(1, attempts) && !best)
      return withMeta(keepBetter(best, result), attempt, transcript)

    best   = keepBetter(best, result)
    prompt = propRetryPrompt(result.report)

    if (!fixNotes && result.ok)
      return withMeta(best, attempt, transcript)
  }

  return withMeta(best as PropToolResult, Math.max(1, attempts), transcript)
}

/** Prefers a built prop, then the fewest complaints. Disposes the loser. */
function keepBetter (current: PropToolResult | null, candidate: PropToolResult): PropToolResult {
  if (!current)
    return candidate

  const winner = score(candidate) < score(current) ? candidate : current
  const loser  = winner === candidate ? current : candidate
  loser.prop?.dispose()
  return winner
}

function score (result: PropToolResult): number {
  if (!result.ok)
    return 1000 + result.issues.filter(issue => issue.level === 'error').length
  return (result.review?.notes.length ?? 0) * 10 + result.issues.filter(issue => issue.level === 'warning').length
}

function withMeta (result: PropToolResult, attempts: number, transcript: string[]): PropGeneration {
  return { ...result, attempts, transcript }
}

/**
 * Build one of the worked examples, or any spec, without a model in the loop —
 * the fixture path for tests, demos, and "show me what this looks like".
 *
 * @returns The built prop and its critique.
 * @example
 * const { prop, review } = buildAndReview(PROP_EXAMPLES[0].spec)
 */
type BuildAndReviewReturnType = { prop: Prop, review: PropReview, spec: NormalizedPropSpec }

export function buildAndReview (spec: unknown): BuildAndReviewReturnType {
  const validated = validatePropSpec(spec)
  if (!validated.spec)
    throw new Error(`buildAndReview: unusable spec\n${validated.report}`)

  const prop = buildProp(validated.spec, { trusted: true })
  return { prop, review: reviewProp(prop), spec: validated.spec }
}

// perf: nothing here runs per frame. generateProp is network-bound; the build
// and critique around it are microseconds.
