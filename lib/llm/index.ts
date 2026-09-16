// lib/llm/index.ts
// The package's instructions, as data.
//
// `llms.txt` and `llm/AGENTS.md` are files, which is right for a model reading
// a repository and wrong for a program composing a prompt. This entry point is
// the same content reachable in code: the rule catalogue as objects, the module
// registry as objects, and the paths of the shipped markdown so a host can read
// or ship them without hardcoding a node_modules layout.
//
//   import { RULES, describeRules, assetPath } from 'threejs-scene/llm'

import { RULES, RuleEnforcement, RuleSeverity } from './rules.js'
import { describeModules, moduleCatalog } from '../app/registry.js'

import type { Rule } from './rules.js'


/** A markdown or JSON asset shipped inside the package for language models. */
export interface LlmAsset {

  /** Path relative to the package root. */
  path: string

  kind: 'instructions' | 'rules' | 'modules' | 'agent' | 'skill' | 'api'

  /** One line: what it is and when to read it. */
  summary: string
}

/**
 * Every LLM-facing file the package ships, in the order an agent should meet
 * them. Paths are relative to the package root — resolve one with
 * {@link assetPath}.
 */
export const LLM_ASSETS: readonly LlmAsset[] = [
  {
    path:    'llm/AGENTS.md',
    kind:    'instructions',
    summary: 'How to compose this package: the contract, the three properties, the rules, and the recipes. Read this first.',
  },
  {
    path:    'llms.txt',
    kind:    'api',
    summary: 'Every export with its real signature, generated from the built type declarations. Read this instead of guessing at the API.',
  },
  {
    path:    'llm/RULES.md',
    kind:    'rules',
    summary: 'The 17 enforced rules with rationale and a wrong/right pair each.',
  },
  {
    path:    'llm/rules.json',
    kind:    'rules',
    summary: 'The same rules as machine-readable JSON.',
  },
  {
    path:    'llm/modules.json',
    kind:    'modules',
    summary: 'The module catalogue: id, summary, import subpath, capabilities, options, cost.',
  },
  {
    path:    'llm/agents',
    kind:    'agent',
    summary: 'Predefined agent definitions — scene builder, module author, effect author, asset author, determinism auditor, performance auditor.',
  },
  {
    path:    'llm/skills/threejs-scene',
    kind:    'skill',
    summary: 'The package as a skill, for hosts that load skills.',
  },
]

/**
 * Resolve a shipped asset to a URL inside the installed package.
 *
 * @param path - A path from {@link LLM_ASSETS}, relative to the package root.
 * @returns The resolved URL. Read it with `fs.readFileSync(new URL(...))`.
 * @example
 * const text = readFileSync(assetPath('llm/AGENTS.md'), 'utf8')
 */
export function assetPath (path: string): URL {
  return new URL(`../../${path}`, import.meta.url)
}

/**
 * The rule catalogue as markdown — a table, then the error-severity rules in
 * full. What to paste into a system prompt when the whole `RULES.md` is more
 * than the budget allows.
 *
 * @param options - `all: true` includes warn-severity rules in full too.
 * @returns Markdown.
 */
export function describeRules ({ all = false }: { all?: boolean } = {}): string {
  const rows = RULES.map(rule =>
    `| \`${rule.code}\` | ${rule.id} | ${rule.title} | ${rule.severity} | ${rule.enforcedBy.join(', ')} |`)

  const detail = RULES
    .filter(rule => all || rule.severity === RuleSeverity.Error)
    .map(rule => [
      `### ${rule.code} · ${rule.id}`,
      '',
      rule.rationale,
      '',
      '```ts',
      `// wrong`,
      rule.wrong,
      '',
      `// right`,
      rule.right,
      '```',
    ].join('\n'))

  return [
    '| code | id | rule | severity | enforced by |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...detail,
  ].join('\n')
}

/**
 * Everything a model needs about this package that is not a type signature:
 * the rules and the registered modules, as one markdown block.
 *
 * Import the module subpaths you care about first — a descriptor registers when
 * its module is imported, so the catalogue reflects what is actually loaded.
 *
 * @returns Markdown, roughly 200 lines.
 * @example
 * import 'threejs-scene/modules/all'
 * import { instructions } from 'threejs-scene/llm'
 *
 * const system = `${basePrompt}\n\n${instructions()}`
 */
export function instructions (): string {
  return [
    '## threejs-scene — enforced rules',
    '',
    describeRules(),
    '',
    '## threejs-scene — available modules',
    '',
    describeModules(),
  ].join('\n')
}

export { RULES, RuleEnforcement, RuleSeverity, findRule, ruleMessage } from './rules.js'
export { describeModules, listModules, moduleCatalog, capabilityMap } from '../app/registry.js'
export type { Rule, RuleCode } from './rules.js'

/** Re-exported so a consumer can serialise the catalogue without a second import. */
export const catalog = moduleCatalog

/** The rule type, re-exported for a host building its own renderer. */
export type { Rule as LlmRule }
