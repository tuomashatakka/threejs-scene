// lib/llm/rules.ts
// The rule catalogue — one source of truth for three consumers that would
// otherwise drift apart: the strict-mode runtime (which throws these codes),
// the ESLint plugin (whose rule ids are these ids), and the shipped agent
// instructions (generated from this array by scripts/gen-llm-assets.ts).
//
// A rule earns its place here only if breaking it produces code that COMPILES
// AND RUNS and is still wrong — a scene that drifts between replays, a module
// that leaks a texture per remount, a state write that lands mid-tick. Style
// belongs in the linter config, not here.

/** How loudly a violation is reported. */
export enum RuleSeverity {
  Error = 'error',
  Warn = 'warn',
}

/** Where a rule is actually enforced, rather than merely recommended. */
export enum RuleEnforcement {

  /** Strict mode throws or reports it at runtime. */
  Runtime = 'runtime',

  /** The shipped ESLint plugin flags it statically. */
  Eslint = 'eslint',

  /** Checked by `auditModule` / the contract test kit. */
  Audit = 'audit',

  /** Not mechanically checkable — an agent or a reviewer must hold the line. */
  Review = 'review',
}

/** One enforced rule of package usage. */
export interface Rule {

  /** Stable numeric code, quoted in runtime errors: `SC004`. */
  code: string

  /** Kebab id, shared with the ESLint rule name: `scoped-root`. */
  id: string

  /** One line, imperative. */
  title: string

  severity:   RuleSeverity
  enforcedBy: readonly RuleEnforcement[]

  /** Why breaking it produces code that runs and is still wrong. */
  rationale: string

  /** The shape that looks fine and is not. */
  wrong: string

  /** The shape to write instead. */
  right: string
}

/**
 * Every enforced rule, in the order an agent should meet them. Ordered by how
 * expensive the mistake is to find later, not by topic.
 */
export const RULES: readonly Rule[] = [
  {
    code:       'SC001',
    id:         'single-frame-loop',
    title:      'createApp owns the only frame loop',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Eslint ],
    rationale:
      'A second loop runs outside the fixed clock, so its work is not part of a tick: it sees ' +
      'torn state, it is invisible to `app.tick()` in a headless test, and it keeps running after ' +
      '`dispose`. In strict mode a module\'s `ctx.loop` refuses to take subscribers for exactly this reason.',
    wrong: 'build (ctx) { ctx.loop.onFrame(() => spin()); requestAnimationFrame(tick) }',
    right: 'update (state, frame, ctx) { spin(frame.delta) }',
  },
  {
    code:       'SC002',
    id:         'no-nondeterminism',
    title:      'Take randomness from ctx.rng and time from frame',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Eslint ],
    rationale:
      '`Math.random`, `Date.now` and `performance.now` make the same seed and the same tick ' +
      'sequence produce different worlds, which turns every replay, snapshot test and bug report ' +
      'into a coin flip. Strict mode traps all three for the duration of a lifecycle hook.',
    wrong: 'const x = Math.random() * 10; mesh.rotation.y = Date.now() * 0.001',
    right: 'const x = ctx.rng.range(0, 10); mesh.rotation.y = frame.elapsed',
  },
  {
    code:       'SC003',
    id:         'fork-rng-by-name',
    title:      'Fork the rng per consumer, by label',
    severity:   RuleSeverity.Warn,
    enforcedBy: [ RuleEnforcement.Eslint, RuleEnforcement.Review ],
    rationale:
      'Consumers drawing from one stream are coupled by draw order: adding a tree reshuffles every ' +
      'rock placed after it. A fork is derived from a label hash, so each consumer keeps its stream ' +
      'no matter what else exists. The runtime already forks per module id; fork again per feature.',
    wrong: 'const height = ctx.rng.range(1, 3)   // shared stream',
    right: "const trees = ctx.rng.fork('trees'); const height = trees.range(1, 3)",
  },
  {
    code:       'SC004',
    id:         'scoped-root',
    title:      'Build into ctx.root, never straight into ctx.scene',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Eslint, RuleEnforcement.Audit ],
    rationale:
      'The root is the module\'s scope: the runtime attaches it at mount, detaches and disposes it ' +
      'at teardown, and can hide or reorder the whole feature by touching one object. Objects added ' +
      'straight to the scene are adopted as a fallback, but they are no longer yours to reason about.',
    wrong: 'build (ctx) { ctx.scene.add(mesh) }',
    right: 'build (ctx) { ctx.root.add(mesh) }',
  },
  {
    code:       'SC005',
    id:         'own-your-resources',
    title:      'Route every GPU allocation through ctx.own',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Audit ],
    rationale:
      'three.js never frees GPU memory for you. An owned resource is disposed in reverse order at ' +
      'teardown whether the module remembered or not, which is the difference between remounting a ' +
      'scene a hundred times and losing the context on the twelfth.',
    wrong: 'const map = new THREE.DataTexture(data, 64, 64)   // never disposed',
    right: 'const map = ctx.own(new THREE.DataTexture(data, 64, 64))',
  },
  {
    code:       'SC006',
    id:         'no-state-write-in-update',
    title:      'Never write app state from inside a lifecycle hook',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Eslint ],
    rationale:
      'A store write mid-tick means the modules updated before it and the modules updated after it ' +
      'saw different worlds in the same tick — the tick stops being reproducible. `ctx.commit` queues ' +
      'the patch and the runtime drains it at the tick boundary, in module order then emission order.',
    wrong: 'update (state) { state.speed += 1; app.setState({ speed: 2 }) }',
    right: 'update (state, frame, ctx) { ctx.commit({ speed: state.speed + 1 }) }',
  },
  {
    code:       'SC007',
    id:         'commit-needs-scope',
    title:      'Only a module that owns a state key may commit',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime ],
    rationale:
      'Unscoped commits from several modules race for the same keys and the last drain wins, ' +
      'silently. `defineScopedModule(at, initial, …)` gives the module one key: it reads that key and ' +
      'its commits merge into that key, so two modules can never collide.',
    wrong: "defineModule({ name: 'hud', update: (s, f, ctx) => ctx.commit({ score: 1 }) })",
    right: "defineScopedModule<State, 'hud'>('hud', { score: 0 }, { name: 'hud', … })",
  },
  {
    code:       'SC008',
    id:         'pure-select',
    title:      'select is a pure, cheap projection',
    severity:   RuleSeverity.Warn,
    enforcedBy: [ RuleEnforcement.Review ],
    rationale:
      'It runs once per module per tick, before any scene work. Allocating or reading the scene from ' +
      'it makes the read path a write path and puts a garbage-collection pause in the frame budget.',
    wrong: 'select: state => ({ ...state, extras: buildExtras() })',
    right: 'select: state => state.terrain',
  },
  {
    code:       'SC009',
    id:         'declare-dependencies',
    title:      'Resolve only what you declared in requires/optional',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime ],
    rationale:
      'The runtime orders providers before consumers using the declarations. An undeclared resolve ' +
      'happens to work while the mount order is lucky and breaks the day somebody reorders `use: []`.',
    wrong: 'start (ctx) { ctx.resolve(Physics) }   // nothing declared',
    right: 'requires: [ Physics ], start (ctx) { ctx.resolve(Physics) }',
  },
  {
    code:       'SC010',
    id:         'provide-what-you-declare',
    title:      'Publish every capability you declare, during build',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime ],
    rationale:
      'Consumers resolve in `start`, one phase after every build. A declared-but-unpublished ' +
      'capability turns that into an undefined at the far end of the app instead of a mount failure here.',
    wrong: 'provides: [ CameraRig ], build () { /* forgot to provide */ }',
    right: 'provides: [ CameraRig ], build (ctx) { ctx.provide(CameraRig, rig) }',
  },
  {
    code:       'SC011',
    id:         'single-render-claim',
    title:      'One render hook wins — know which',
    severity:   RuleSeverity.Warn,
    enforcedBy: [ RuleEnforcement.Runtime ],
    rationale:
      'The last module in resolved order that defines `render` owns the draw, and a top-level ' +
      '`AppOptions.render` overrides every module. Two composers mounted together is not an error, it ' +
      'is one composer silently never drawing.',
    wrong: 'use: [ postProcessing(), postProcessing() ]',
    right: 'use: [ postProcessing({ effects }) ]   // one claim, ordered last',
  },
  {
    code:       'SC012',
    id:         'build-once',
    title:      'Generate in build, animate in update',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Audit ],
    rationale:
      'Allocating in `update` runs at tick rate: it rebuilds buffers the GPU has already uploaded and ' +
      'produces a sawtooth of garbage collection that reads as a frame-rate bug. Strict mode counts ' +
      'objects added to the root during update and reports the growth.',
    wrong: 'update () { root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat)) }',
    right: 'build (ctx) { mesh = ctx.own(new THREE.Mesh(geometry, material)) }',
  },
  {
    code:       'SC013',
    id:         'explicit-fps',
    title:      'Always pass loop.fps explicitly, including 0',
    severity:   RuleSeverity.Warn,
    enforcedBy: [ RuleEnforcement.Review ],
    rationale:
      'The cap lives on a shared page-global framecapper, so a scene that omits it inherits whatever ' +
      'the last scene on the page asked for — which is how one embedded demo pins a whole site to 30fps.',
    wrong: 'createApp(canvas, { use })',
    right: 'createApp(canvas, { loop: { fps: 0 }, use })',
  },
  {
    code:       'SC014',
    id:         'dom-free-assets',
    title:      'Keep modules/assets DOM-free and SSR-safe',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Eslint, RuleEnforcement.Review ],
    rationale:
      'Textures are `DataTexture`, never a canvas, which is the only reason the asset layer runs in a ' +
      'headless test and inside a server render. One `document.createElement` undoes it for everybody.',
    wrong: "const canvas = document.createElement('canvas')",
    right: 'new THREE.DataTexture(pixels, width, height)',
  },
  {
    code:       'SC015',
    id:         'mark-shared-resources',
    title:      'Mark pooled resources shared before disposing a tree',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Audit, RuleEnforcement.Review ],
    rationale:
      '`disposeScene` frees everything it walks, pooled materials included. One kit material shared ' +
      'between props, disposed from one owner\'s teardown, blanks every other prop still using it — ' +
      'which reads as a rendering bug, not a lifecycle one.',
    wrong: 'disposeScene(root)   // root holds the shared kit material',
    right: 'material.userData.shared = true   // or dispose per module',
  },
  {
    code:       'SC016',
    id:         'unique-module-name',
    title:      'Module names are unique and stable',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime ],
    rationale:
      'The name is the rng fork label and the handle id. Two modules called `props` draw the same ' +
      'random stream and shadow each other in diagnostics; renaming one changes its world.',
    wrong: "use: [ props(), props() ]   // both named 'props'",
    right: "use: [ props({ name: 'trees' }), props({ name: 'rocks' }) ]",
  },
  {
    code:       'SC017',
    id:         'sync-lifecycle',
    title:      'Lifecycle hooks are synchronous',
    severity:   RuleSeverity.Error,
    enforcedBy: [ RuleEnforcement.Runtime, RuleEnforcement.Eslint ],
    rationale:
      'An async hook resolves after the phase it belongs to has finished: the runtime has already ' +
      'started the next module, or already disposed this one. Load first, then mount the module with ' +
      'what you loaded.',
    wrong: 'async build (ctx) { const gltf = await load(url); ctx.root.add(gltf.scene) }',
    right: 'const gltf = await load(url); app.use(modelModule(gltf))',
  },
] as const

/** Every rule code, for exhaustiveness checks. */
export type RuleCode = typeof RULES[number]['code']

const BY_CODE = new Map<string, Rule>(RULES.map(entry => [ entry.code, entry ]))
const BY_ID   = new Map<string, Rule>(RULES.map(entry => [ entry.id, entry ]))

/**
 * Look a rule up by code (`'SC004'`) or kebab id (`'scoped-root'`).
 *
 * @param key - The code or id.
 * @returns The {@link Rule}, or `undefined` when nothing matches.
 */
export function findRule (key: string): Rule | undefined {
  return BY_CODE.get(key) ?? BY_ID.get(key)
}

/**
 * Format a violation the way strict mode reports it: code, title, the specific
 * detail, and where to read the reasoning.
 *
 * @param key - Rule code or id.
 * @param detail - What actually happened, including the module id.
 * @returns A single-line message.
 */
export function ruleMessage (key: string, detail: string): string {
  const found = findRule(key)

  if (!found)
    return `${key}: ${detail}`

  return `[${found.code} ${found.id}] ${detail} — ${found.title}.`
}
