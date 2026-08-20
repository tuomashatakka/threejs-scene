// scripts/gen-llms.ts
// Build `llms.txt` — the file an agent reads instead of guessing at this API.
//
// Generated from the built `.d.ts`, not hand-maintained, because the failure
// mode of a hand-written API list is that it drifts and then confidently
// describes a function that no longer takes those arguments. A stale list is
// worse than no list: an agent trusts it.
//
// The prose half lives in this file. It is the part a signature cannot express —
// which import path to reach for, what the loop owns, and the handful of traps
// that produce code which compiles and then behaves wrongly.
//
//   bun scripts/gen-llms.ts          # writes llms.txt
//   bun scripts/gen-llms.ts --check  # exits 1 if it would change

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'


const ROOT    = new URL('..', import.meta.url).pathname
const DIST    = join(ROOT, 'dist')
const OUT     = join(ROOT, 'llms.txt')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string

/** Entry points, in the order an agent should meet them. */
const ENTRIES: readonly { subpath: string, index: string, blurb: string }[] = [
  { subpath: 'threejs-scene', index: 'lib/index.d.ts', blurb: 'the app shell: loop, store, camera, renderer, input, disposal, diagnostics' },
  { subpath: 'threejs-scene/modules/assets', index: 'modules/assets/index.d.ts', blurb: 'procedural geometry, materials, textures, props. DOM-free and deterministic' },
  { subpath: 'threejs-scene/modules/post', index: 'modules/post/index.d.ts', blurb: 'the post-processing module and its composer' },
  { subpath: 'threejs-scene/modules/post/webgl', index: 'modules/post/webgl/index.d.ts', blurb: 'the individual passes' },
  { subpath: 'threejs-scene/modules/lighting', index: 'modules/lighting/index.d.ts', blurb: 'standard light rigs' },
  { subpath: 'threejs-scene/modules/orbit', index: 'modules/orbit/index.d.ts', blurb: 'orbit controls as a module' },
  { subpath: 'threejs-scene/modules/physics', index: 'modules/physics/index.d.ts', blurb: 'fixed-step rigid bodies, cloth, liquid. Needs the optional `cannon-es` peer' },
]

interface Symbol_ {
  name:      string
  kind:      string
  signature: string
}

function sourceFiles (root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name)

    if (statSync(path).isDirectory())
      return name === 'cjs' ? [] : sourceFiles(path)

    return path.endsWith('.d.ts') ? [ path ] : []
  })
}

/**
 * Every declared export in one `.d.ts`, with its signature flattened to a line.
 *
 * Regex rather than the TypeScript compiler API, to keep this dependency-free —
 * the shapes it has to match are the ones `tsc` emits, which are far more
 * uniform than hand-written source.
 */
function declarations (file: string): Symbol_[] {
  const text             = readFileSync(file, 'utf8')
  const found: Symbol_[] = []

  // A declaration runs to the first `;` at the end of a line, or to the closing
  // brace of an interface/class body.
  const pattern = /^export declare (function|const|class|abstract class|enum) ([\w$]+)([\s\S]*?);$/gmu

  for (const match of text.matchAll(pattern)) {
    const [ , kind, name, rest ] = match

    if (!name || !kind)
      continue

    const flat = (rest ?? '').replace(/\s+/gu, ' ').trim()

    found.push({
      name,
      kind: kind.replace('abstract class', 'class'),

      // `({ a, b }?: Opts)` is how the implementation destructures its argument;
      // a caller passes one object, so say that instead.
      signature: `${name}${flat.replace(/\{[^{}]*\}(\??):/gu, 'options$1:')}`,
    })
  }

  for (const match of text.matchAll(/^export (interface|type) ([\w$]+)/gmu)) {
    const [ , kind, name ] = match

    if (name && kind)
      found.push({ name, kind, signature: name })
  }

  return found
}

/** Which names an entry's barrel actually re-exports. */
function exported (index: string): Set<string> {
  const text  = readFileSync(index, 'utf8')
  const names = new Set<string>()
  let wildcard = false

  for (const match of text.matchAll(/^export (?:type )?\{([\s\S]*?)\} from/gmu))
    for (const raw of (match[1] ?? '').split(','))
      if (raw.trim())
        names.add(raw.trim().split(/\s+as\s+/u)[0]!.trim())

  for (const _ of text.matchAll(/^export \* from/gmu))
    wildcard = true

  if (wildcard)
    names.add('*')

  return names
}

function section (entry: typeof ENTRIES[number]): string {
  const index = join(DIST, entry.index)
  const dir   = join(DIST, entry.index.replace(/\/index\.d\.ts$/u, ''))
  const names = exported(index)
  const open  = names.has('*')

  // Two ways to be exported from an entry: declared in its `index.d.ts`
  // outright, or re-exported there from a sibling file. `lighting` and `orbit`
  // are the first kind and have no `from` clauses at all, so a barrel-only scan
  // finds nothing and silently drops them.
  const own = new Set(declarations(index).map(symbol => symbol.name))

  const symbols = sourceFiles(dir)
    .flatMap(declarations)
    .filter(symbol => own.has(symbol.name) || open || names.has(symbol.name))

  // Deduplicate: a barrel and its source both declare the same name.
  const unique = new Map<string, Symbol_>()

  for (const symbol of symbols)
    if (!unique.has(symbol.name) || symbol.signature.length > unique.get(symbol.name)!.signature.length)
      unique.set(symbol.name, symbol)

  const byKind = (kind: string): Symbol_[] =>
    [ ...unique.values() ].filter(s => s.kind === kind).sort((a, b) => a.name.localeCompare(b.name))

  const lines = [ `### \`${entry.subpath}\`\n`, `${entry.blurb}\n` ]

  for (const [ kind, label ] of [[ 'function', 'functions' ], [ 'const', 'values' ], [ 'class', 'classes' ]] as const) {
    const group = byKind(kind)

    if (group.length === 0)
      continue

    lines.push(`\n**${label}** (${group.length})\n`, '```ts')
    for (const symbol of group)
      lines.push(symbol.signature)
    lines.push('```')
  }

  const types = [ ...byKind('interface'), ...byKind('type') ].map(s => s.name).sort()

  if (types.length)
    lines.push(`\n**types** (${types.length}): ${types.map(t => `\`${t}\``).join(', ')}`)

  return `${lines.join('\n')}\n`
}

const PREAMBLE = `# threejs-scene ${VERSION}

Deterministic imperative three.js scenes. Vanilla three — **not** react-three-fiber.
An app shell plus a module contract, a seeded rng, a fixed clock, and an explicit
dispose chain.

This file is generated from the built type declarations, so every signature below
is the real one for this exact version.

## The contract, in full

\`\`\`ts
import { createApp, defineModule } from 'threejs-scene'

interface State { speed: number }

const turbine = defineModule<State>({
  name: 'turbine',
  build (ctx)                { /* create objects once, add to ctx.scene */ },
  update (state, frame, ctx) { /* project state onto them, every sim tick */ },
  resize (size, ctx)         { /* optional */ },
  render (frame, ctx)        { /* optional — claims the draw */ },
  dispose ()                 { /* release everything build allocated */ },
})

const app = createApp<State>(canvas, { state: { speed: 1 }, use: [ turbine ] })

app.start()                    // attach to the frame loop
app.setState({ speed: 2 })     // shallow-merge, notifies subscribers
app.tick(1 / 60)               // step deterministically instead (headless)
app.dispose()                  // loop, modules (reverse order), scene, renderer
\`\`\`

State flows **down** (\`store → module.update → scene\`); input flows **back**
through \`setState\`/\`dispatch\`. Never write app state from inside a scene object.
Same seed plus same tick sequence reproduces the same world, headless included.

\`ctx\` is a \`SceneContext\`: \`{ scene, camera, renderer, rng, clock }\`. The \`rng\`
is seeded from \`AppOptions.seed\`.

## Rules that stop working code from behaving wrongly

1. **\`createApp\` owns the only render loop.** Never call
   \`requestAnimationFrame\` yourself. Animate in \`update\`.
2. **The frame cap is page-global.** \`loop.fps\` goes to a shared framecapper
   ([\`@tuomashatakka/canvas-loop-framecapper\`](https://www.npmjs.com/package/@tuomashatakka/canvas-loop-framecapper)),
   so it applies to every loop on the page. Always pass it explicitly, including
   \`0\` for uncapped — a scene that omits it inherits whatever the last one asked
   for.
3. **The loop starts paused.** Call \`start()\`, or \`tick()\` per frame yourself.
4. **Generation in \`build\`, animation in \`update\`, viewport in \`resize\`,
   teardown in \`dispose\`.** Everything a module puts on the GPU it releases.
5. **Only one \`render\` hook wins.** Last-mounted module takes it; a top-level
   \`AppOptions.render\` overrides all of them. Prefer the module.
6. **\`modules/assets\` is DOM-free and SSR-safe** — textures are \`DataTexture\`,
   never canvas. Keep it that way; it is what makes headless tests work.
7. **Determinism is a feature.** Use \`createSeededRng\` and fork it by name
   (\`rng.fork('trees')\`) so adding one consumer does not reshuffle every consumer
   after it. Never \`Math.random\`. Never \`Date.now\` for animation — take time
   from \`frame\`.
8. **\`disposeScene\` and \`disposeMaterial\` dispose indiscriminately.** If you
   pool materials, mark them with \`markShared\` and tear down per module instead.

## Choosing an import path

Everything ships ESM **and** CJS, so \`require('threejs-scene')\` resolves from a
server bundle.

| need | path |
| --- | --- |
| app shell, loop, store, camera, input, diagnostics | \`threejs-scene\` |
| geometry, materials, textures, props | \`threejs-scene/modules/assets\` |
| a post chain | \`threejs-scene/modules/post\` |
| one specific pass | \`threejs-scene/modules/post/webgl\` |
| light rigs | \`threejs-scene/modules/lighting\` |
| orbit controls | \`threejs-scene/modules/orbit\` |
| rigid bodies, cloth, liquid | \`threejs-scene/modules/physics\` (peer: \`cannon-es\`) |

## Camera choice matters for passes

\`createIsoCamera\` returns an **orthographic** rig. Several three.js passes are
written for a perspective camera and misbehave under ortho — \`BokehPass\`-based
depth of field is the usual one, and god-ray style passes that test whether the
sun is behind the camera need a hand-supplied screen position instead. Check
before wiring a pass into an ortho scene.

\`createFollowCamera\` is a damped **perspective** chase rig; it is not an ortho
follow.

## When it works everywhere except on one device

three links every program when the app mounts but does not *check* the link until
the program's first use — so a program that will not link is bound to a draw
anyway, every draw raises \`INVALID_OPERATION\`, and the driver eventually takes
the context away. It looks thermal. It is not.

\`\`\`ts
import { reportPrograms } from 'threejs-scene'

const halt = reportPrograms(app.ctx.renderer, { say: log, fail: log }, false)

if (!halt)
  app.start()   // draws are what turn a refused program into a dead context
\`\`\`

For refusals the driver logs nothing about: \`readVaryings(source)\` walks the
\`#ifdef\`s and \`#define\`s *together*, so a varying inside a branch the program
never takes is not counted; \`packedRows\` packs them as a driver would, and
\`varyingRowLimit(gl)\` says how many rows this one has.

Then \`readQualitySignals()\` for the cheap device proxies and
\`createLadderMemory\` to stop re-learning a crash on every load. Neither picks a
budget — that mapping is yours.

## State that outlives one mount

\`createStore\` commits a **new object** on every write. Two consequences:

- A section destructured at build time and read every frame silently freezes.
  Read through a getter per frame instead.
- \`withPath(state, path, value)\` is \`writePath\` without the mutation — copies
  only the spine, and returns the **same** object when the value was already
  there, so a no-op write notifies nobody.

\`createStateAccess(authored)\` covers the case where ownership changes over time:
a plain object before the app mounts, the store after \`adopt(store)\`, and the
last committed state handed back by the release function on teardown.

## Full export index

`

const generated = `${PREAMBLE}${ENTRIES.map(section).join('\n')}
---

Generated by \`scripts/gen-llms.ts\` from \`dist/**/*.d.ts\` at version ${VERSION}.
Regenerate after changing any public signature: \`bun scripts/gen-llms.ts\`.
`

if (process.argv.includes('--check')) {
  const current = (() => {
    try {
      return readFileSync(OUT, 'utf8')
    }
    catch {
      return ''
    }
  })()

  if (current !== generated) {
    console.error('llms.txt is stale — run `bun scripts/gen-llms.ts`')
    process.exit(1)
  }

  console.log(`llms.txt matches threejs-scene@${VERSION}`)
}
else {
  writeFileSync(OUT, generated)

  const symbols = generated.match(/^[a-zA-Z$][\w$]*[<(]/gmu)?.length ?? 0

  console.log(`llms.txt  ${generated.split('\n').length} lines · ${symbols} signatures · threejs-scene@${VERSION}`)
}

export { declarations, exported }
