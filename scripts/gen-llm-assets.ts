// scripts/gen-llm-assets.ts
// Build the machine-readable half of the LLM payload: `llm/rules.json`,
// `llm/RULES.md`, `llm/modules.json` and `llm/index.json`.
//
// Generated from the built output rather than hand-maintained, for the same
// reason `llms.txt` is. A hand-written rule list drifts, and a drifted rule list
// is worse than none: an agent reads "SC004 says build into ctx.root", writes
// code against it, and the runtime reports a rule with different text and a
// different code. The catalogue has the same problem one level up — a module
// list that mentions a module the package no longer exports is a tool call that
// fails at the far end of somebody's build.
//
// So both come out of the code. `llm/AGENTS.md`, the agent definitions and the
// skill stay hand-written, because prose explaining WHY is not derivable from a
// type.
//
//   bun scripts/gen-llm-assets.ts          # writes the files
//   bun scripts/gen-llm-assets.ts --check  # exits 1 if it would change
//
// Runs after `npm run build`, like gen-llms.ts, because it imports from dist/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'


const ROOT    = new URL('..', import.meta.url).pathname
const DIST    = join(ROOT, 'dist')
const LLM     = join(ROOT, 'llm')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string

if (!existsSync(DIST)) {
  console.error('dist/ is missing — run `npm run build` first')
  process.exit(1)
}

// Imported from the build, not from source: the same objects a consumer gets.
const { RULES } = await import(join(DIST, 'lib/llm/rules.js')) as typeof import('../lib/llm/rules.js')
const { moduleCatalog } = await import(join(DIST, 'lib/app/registry.js')) as typeof import('../lib/app/registry.js')

// importing the barrel is what populates the registry — a descriptor registers
// when its module is imported, so a catalogue built without this is empty
await import(join(DIST, 'modules/all/index.js'))

// physics lives outside modules/all because it needs the optional cannon-es
// peer, so register it separately and let the catalogue miss it when the peer
// is absent rather than failing the whole generation
try {
  await import(join(DIST, 'modules/physics/index.js'))
}
catch {
  console.warn('modules/physics skipped — the optional `cannon-es` peer is not installed')
}

interface Written {
  path: string
  text: string
}

const written: Written[] = []

function emit (relative: string, text: string): void {
  written.push({ path: relative, text })
}

// ── llm/rules.json ──────────────────────────────────────────────────────────

emit('rules.json', `${JSON.stringify({
  generatedFrom: 'lib/llm/rules.ts',
  version:       VERSION,
  rules:         RULES,
}, null, 2)}\n`)

// ── llm/RULES.md ────────────────────────────────────────────────────────────

// The anchor a rule renders under is its lowercased code, because that is what
// the ESLint plugin's meta.docs.url points at — change one and change both.
const anchor = (code: string): string => code.toLowerCase()

const rulesMarkdown = [
  '# threejs-scene — enforced rules',
  '',
  'A rule is here only if breaking it produces code that **compiles, runs, and is still wrong**:',
  'a scene that drifts between replays, a module that leaks a texture per remount, a state write',
  'that lands mid-tick. Style belongs in the linter config, not here.',
  '',
  'Three things enforce them. **Strict mode** reports them at runtime (on by default outside',
  '`NODE_ENV=production`). The **ESLint plugin** (`threejs-scene/eslint`) catches the static shapes',
  'before the code runs, under the same ids. **`auditModule()`** from `threejs-scene/testing` proves',
  'the rest by running a module through two full lifecycles.',
  '',
  `Generated from \`lib/llm/rules.ts\` at version ${VERSION}.`,
  '',
  '| code | id | rule | severity | enforced by |',
  '| --- | --- | --- | --- | --- |',
  ...RULES.map(rule =>
    `| [\`${rule.code}\`](#${anchor(rule.code)}) | ${rule.id} | ${rule.title} | ${rule.severity} | ${rule.enforcedBy.join(', ')} |`),
  '',
  ...RULES.flatMap(rule => [
    `## ${rule.code}`,
    '',
    `**${rule.id}** — ${rule.title}`,
    '',
    `*${rule.severity}, enforced by ${rule.enforcedBy.join(', ')}*`,
    '',
    rule.rationale,
    '',
    '```ts',
    '// wrong',
    rule.wrong,
    '',
    '// right',
    rule.right,
    '```',
    '',
  ]),
].join('\n')

emit('RULES.md', rulesMarkdown)

// ── llm/modules.json ────────────────────────────────────────────────────────

const catalog = moduleCatalog()

emit('modules.json', `${JSON.stringify({
  generatedFrom: 'the module registry, populated by importing every module subpath',
  version:       VERSION,
  ...catalog,
}, null, 2)}\n`)

// ── llm/index.json ──────────────────────────────────────────────────────────

/** The `name` and `description` from a markdown file's YAML frontmatter. */
function frontmatter (file: string): { name: string, description: string } {
  const text  = readFileSync(file, 'utf8')
  const match = /^---\n([\s\S]*?)\n---/u.exec(text)
  const read  = (key: string): string => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(match?.[1] ?? '')
    return found?.[1]?.trim().replace(/^["']|["']$/gu, '') ?? ''
  }

  return { name: read('name'), description: read('description') }
}

const { readdirSync } = await import('node:fs')

const agentDir = join(LLM, 'agents')
const agents   = existsSync(agentDir)
  ? readdirSync(agentDir).filter(name => name.endsWith('.md')).sort()
  : []

const manifest = {
  version: VERSION,
  assets:  [
    { path: 'llm/AGENTS.md', kind: 'instructions', description: 'How to compose this package: the contract, the three properties, the rules, and the recipes. Read this first.' },
    { path: 'llms.txt', kind: 'api', description: 'Every export with its real signature, generated from the built type declarations.' },
    { path: 'llm/RULES.md', kind: 'rules', description: `The ${RULES.length} enforced rules with rationale and a wrong/right pair each.` },
    { path: 'llm/rules.json', kind: 'rules', description: 'The same rules as machine-readable JSON.' },
    { path: 'llm/modules.json', kind: 'modules', description: `The module catalogue: ${catalog.modules.length} modules with import subpaths, capabilities, options and cost.` },
    { path: 'llm/skills/threejs-scene/SKILL.md', kind: 'skill', description: 'The package as a skill, for hosts that load skills.' },
    ...agents.map(name => {
      const { name: agentName, description } = frontmatter(join(agentDir, name))
      return { path: `llm/agents/${name}`, kind: 'agent', name: agentName, description }
    }),
  ],
}

emit('index.json', `${JSON.stringify(manifest, null, 2)}\n`)

// ── write or check ──────────────────────────────────────────────────────────

const stale = written.filter(entry => {
  const file = join(LLM, entry.path)

  try {
    return readFileSync(file, 'utf8') !== entry.text
  }
  catch {
    return true
  }
})

if (process.argv.includes('--check')) {
  if (stale.length > 0) {
    console.error(`stale: ${stale.map(entry => `llm/${entry.path}`).join(', ')} — run \`bun scripts/gen-llm-assets.ts\``)
    process.exit(1)
  }

  console.log(`llm/ matches threejs-scene@${VERSION}`)
}
else {
  for (const entry of written) {
    const file = join(LLM, entry.path)

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, entry.text)
  }

  console.log(
    `llm/  ${RULES.length} rules · ${catalog.modules.length} modules · ` +
    `${Object.keys(catalog.capabilities).length} capabilities · ${agents.length} agents · threejs-scene@${VERSION}`,
  )
}
