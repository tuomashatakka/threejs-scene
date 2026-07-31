// modules/authoring/index.ts
// Prop authoring for language models: a JSON dialect, a forgiving validator, a
// deterministic compiler, and a critic that tells the model what it got wrong.
//
// Like modules/assets these are plain factories rather than AppModules — this is
// content authoring, not per-frame behaviour. Everything is DOM-free and
// GL-free, so a server can validate, build, measure, and critique a prop without
// a canvas anywhere in sight, and a test can do the same headless.
//
//   import { generateProp, createPropTool } from 'threejs-scene/modules/authoring'
//
//   const { prop, review } = await generateProp({ brief: 'a mossy stone well', complete })
//   scene.add(prop)

// the dialect — types, vocabulary, budgets
export { SHAPE_NAMES, SURFACE_NAMES, FLAT_SHAPES, SPEC_LIMITS, PART_DEFAULTS } from './spec.js'
export type {
  AxisName,
  NormalizedPart,
  NormalizedPropSpec,
  NormalizedRepeat,
  PartSpec,
  PropSpec,
  RepeatMode,
  RepeatSpec,
  ShapeName,
  SpecVec3,
} from './spec.js'

// validation — repairs what it can, reports what it cannot
export { validatePropSpec, formatIssues, extractJson } from './validate.js'
export type { IssueLevel, SpecIssue, SpecReview } from './validate.js'

// compilation — spec in, Prop out
export { buildProp, tryBuildProp } from './build.js'
export type { BuildAttempt, BuildPropOptions } from './build.js'

// the shape catalogue, for building one geometry without a whole prop
export { buildShape, fitToSize } from './shapes.js'
export { resolvePlacements } from './layout.js'
export type { Placement } from './layout.js'

// critique — measure the built thing and say what is wrong with it
export { reviewProp } from './review.js'
export type { PropReview } from './review.js'

// prompting — the grammar, the worked examples, the correction turn
export { PROP_SPEC_GRAMMAR, PROP_EXAMPLES, propAuthoringPrompt, propRetryPrompt } from './prompt.js'
export type { PromptOptions, PropExample } from './prompt.js'

// schema — for function calling and constrained decoding
export { PROP_SPEC_SCHEMA } from './schema.js'
export type { JsonSchema } from './schema.js'

// the tool surface + the generate/critique/retry loop
export { createPropTool, generateProp, buildAndReview } from './tool.js'
export type {
  CreatePropToolOptions,
  GeneratePropOptions,
  PropCompletion,
  PropCompletionRequest,
  PropGeneration,
  PropTool,
  PropToolResult,
} from './tool.js'
