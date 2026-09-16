# Changelog

Newest first. One entry per release: the headline, then what it costs a consumer.

## 0.7.0

**Every module lifecycle now handles data in a deterministic, unidirectional, scoped way — and the package ships the instructions for using it.**

The module contract gained the machinery that was previously left to each module's discipline. Nothing was removed: `AppModule` is a superset of what it was, `ModuleContext` is a superset of `SceneContext`, and existing modules keep working. What changed is that the guarantees are now the runtime's job rather than the author's.

### Scoped

- **Every module gets a `ctx.root`** — a `THREE.Group` attached to the scene at mount, and detached, emptied and disposed at teardown. Build into it; the objects under it need no teardown code at all.
- **`ctx.own(resource)`** takes anything with a `dispose()`, any `Object3D`, or a plain teardown function, registers it, and returns it — so ownership costs one word inline. Owned resources release in the exact inverse of registration, after `dispose()` and after `ctx.onCleanup` callbacks.
- **`ctx.rng` is forked by module id.** Adding a module no longer reshuffles the ones beside it.
- **Objects added straight to `ctx.scene` are still adopted and torn down**, because ownership is not optional — but strict mode says so, with rule `SC004`.

### Unidirectional

- **`ctx.commit(patch)` replaces reaching for the app.** Commits are queued and drained *after every module has updated in that tick*, in module order then emission order, merged into one store write. No module ever observes a world another module half-changed, and the same tick sequence replays identically.
- **Only a module that owns a state key may commit.** `defineScopedModule(at, initial, …)` gives it one key: it reads that key and its commits merge into that key, so two modules cannot collide. An unscoped commit is refused (`SC007`).
- **`select` narrows what a module reads** to a projection of app state, and in strict mode the view is deep-frozen — writing through it throws where it happens rather than surfacing three ticks later.
- **`setState` from inside a lifecycle hook is reported and dropped** (`SC006`) instead of landing mid-tick.

### Deterministic

- **Mount order is a pure function of the module list**: a stable topological sort over declared capabilities, tie-broken by the new `order` band and then insertion index. A list with no declarations runs exactly as written; a list with declarations runs in the only order that satisfies them, disturbing the rest as little as possible.
- **Strict mode traps `Math.random`, `Date.now` and `performance.now`** during lifecycle calls, attributes the call site, and ignores three.js's own uuid generation. It also counts per-tick allocation, diffs the scene after build, and checks every declared capability was published.

### Everything is a pluggable module

- **Capability tokens.** `capability<Api>('name')`, `provides`/`requires`/`optional`, `ctx.provide`/`ctx.resolve`. Modules find each other through a declared contract rather than an import, so implementations are swappable — `orbitControls()` and `cameraRig()` both provide `camera-rig`.
- **Six new modules** for things that were libraries beside the app: `camera` (iso/follow/perspective rigs), `input` (pointer sampled into the tick, with a raycast helper), `quality` (device ladder that measures, steps down, and remembers), `diagnostics` (shader-link audit and `renderer.info` sampling), `persistence` (a state key restored as a queued commit, written back on a timer), and `assets` (the procedural library given one owner and one forked rng).
- **Plugins.** `definePlugin({ name, use })` bundles modules that only make sense together; `createApp({ plugins: [] })` flattens them ahead of `use`.
- **A module registry.** Every built-in registers a descriptor — id, summary, import subpath, capabilities, options, cost — so the module set is enumerable instead of discoverable only by reading the source.
- **`threejs-scene/testing`.** `auditModule()` runs a module through two full lifecycles and reports contract violations, undisposed GPU resources, objects stranded on the scene, and any difference between the two runs from the same seed. Plus `headlessApp`, `testModuleContext`, `snapshotObject`, `stubRenderer`, `stubCanvas`.

### The package tells a model how to use all of it

`llms.txt` listed the API. It could not say how to compose it, and nothing enforced the rules it described.

- **`llm/AGENTS.md`** — the reference: the contract annotated, the three properties with their mechanisms, all 17 rules, six worked recipes that compile, composition and ordering, and a symptom-to-rule-code troubleshooting table.
- **Six predefined agents** in `llm/agents/` — scene builder, module author, effect author, asset author, determinism auditor, performance auditor — each with the workflow it follows, the rules it owns, and the checklist it runs before claiming done. Plus the package as a skill.
- **`threejs-scene/eslint`** — a flat-config plugin with seven AST rules carrying the same ids and codes as the runtime. Verified in both directions: it fires nine findings on a fixture of deliberate violations and none on this package's own source.
- **`npx threejs-scene`** — `agents install`, `instructions`, `rules [SC004]`, `modules`, `skill`, `doctor`. Instructions nobody can find are instructions nobody reads.
- **`threejs-scene/llm`** — the same content as data, for a host composing a prompt: `RULES`, `listModules()`, `describeRules()`, `instructions()`.
- **The catalogues are generated** from the rule source and the module registry, with a `--check` mode the release workflow runs. A drifted rule list is worse than none, because an agent trusts it.

### What a consumer has to change

Nothing, to keep working. The behavioural differences worth knowing:

- **`ctx.rng` inside a module is now forked by module id**, so a module drawing from it directly produces different numbers than before. Output changes; determinism improves. Fork by feature (`ctx.rng.fork('trees')`) and it is stable from here on.
- **A module's `ctx` is its own scoped context**, not the app's object — a superset with the same `scene`, `camera` and `renderer`, so structural use is unaffected. Identity comparison against `app.ctx` is not.
- **A module's `ctx.loop` refuses subscribers in strict mode** (`SC001`). Nothing in the package did this; `app.ctx.loop` is unchanged for app-level code.
- **Strict mode is on by default outside `NODE_ENV=production`** and reports to the console. Pass `strict: false`, or `onViolation` to route it elsewhere.

## 0.6.2

**Tighter, cheaper light-shaft defaults.**

- **God rays default `decay` 0.95 → 0.9 and `density` 0.9 → 0.33.** The previous `density` marched shafts too far per sample, blowing the scatter out; 0.33 keeps them tight. Applies to both the pass uniform and the demo panel.
- **Radial (zoom) blur default `decay` 0.92 → 0.9 and `count` 32 → 64.** More taps for a smoother smear, with the matching decay falloff.
- **Docs:** the public `index.html` Layout section now lists every available module (`lib/camera`, `lib/quality`, `modules/assets`, `modules/lighting`, `modules/orbit`, `modules/physics`, `modules/post`) rather than a partial set.

Purely default-value and documentation changes — no API shapes moved, so this is a drop-in patch for every existing caller.

## 0.6.1

**The package now tells an agent how to use it.**

- **Ships `llms.txt`** — 198 signatures with their generics intact, grouped by the import path that provides them, after a preamble covering the module contract,
  the eight rules that separate code which compiles from code which behaves, which entry point to reach for, the ortho-vs-perspective trap for post passes, and the
  two consequences of `createStore` committing a new object per write. Readable at `node_modules/threejs-scene/llms.txt`.
- **Generated from the built `.d.ts`, never hand-maintained.** The failure mode of a hand-written API list is that it drifts and then confidently describes a
  function that no longer takes those arguments — and an agent trusts it. `npm run llms` regenerates; `npm run llms:check` fails when it is stale, and both
  `prepublishOnly` and the release workflow run it, so a signature change cannot ship with a doc that disagrees.
- Signatures are shown as a *caller* writes them: `tsc` emits the implementation's destructuring (`({ radius, maxPhi }?: OrbitOptions)`), which is rewritten to
  `options?: OrbitOptions`.

## 0.6.0

**Everything a scene needs to survive a device nobody tested it on, plus the two state primitives `createStore` implies.**

Fifteen new exports, all of them lifted out of a consumer that had written them locally and proved them on real hardware. Nothing is removed and nothing changes
shape, so this is additive for every existing caller.

- **`reportPrograms` / `auditPrograms` / `censusPrograms` — read the driver's verdict before you draw.** three links every program on mount but does not check the
  link until first *use*, so a program that will not link gets bound to a draw anyway, every draw raises `INVALID_OPERATION`, and ANGLE eventually takes the
  context. The loss lands seconds after load at whatever moment the bad material came into view — which is why it reads as thermal instead of as a compile error.
  Reading `LINK_STATUS` after compile and before the first frame turns that into a blank screen with a material name on it.
- **The varying census, for the refusals that log nothing.** `readVaryings` walks a shader's `#ifdef`s and `#define`s *together*, so a varying inside a branch the
  program never takes is not counted — `flatShading` wraps `vNormal` in `#ifndef FLAT_SHADED`, and counting declarations flat claims three components the program
  does not spend. `packedRows` packs them the way a driver does; `varyingRowLimit(gl)` says how many rows this driver has. `censusProgram` and `describeCensus`
  are the per-program line. **16 tests**, most of them on the preprocessor walk, because that is the part that is easy to get wrong and impossible to see.
- **`readQualitySignals` / `describeQualitySignals`** — the cheap device proxies (coarse pointer, viewport, `devicePixelRatio`, cores) as data, plus one line for
  a log. They choose nothing; mapping signals to *your* budget stays yours. Thresholds are options, defaulting to 1100/1280 css px — and 1100 rather than 900
  because a phone in landscape is 844–932 css px wide, so 900 cuts through the middle of the range and hands the larger half of every handset to the desktop budget.
- **`createLadderMemory`** — remember which step of a degradation ladder a device survived, stamped with a build token so a deploy that changes what a step costs
  starts the argument again. It only ever argues **downward**: something that survived the top step last week may be throttled or on battery now.
- **`withPath(state, path, value)`** — `writePath` without the mutation. Copies only the spine, so setting one leaf on a twenty-section state copies two objects
  and keeps eighteen by reference. Returns the **same** object when the leaf already held that value, so a slider dragged across a value it is already on notifies
  nobody. This is the write primitive `createStore` always implied and never shipped.
- **`createStateAccess(authored)`** — who owns the state, before and after the app exists. A url is parsed before the mount, a snapshot is applied before it, and a
  context loss takes the app down and builds another one that must open on what the reader moved rather than on what shipped. `adopt(store)` hands ownership over
  and returns a release function that hands it back with the last committed state intact.
- **`openStorage(probe)`** — the `localStorage` probe every persisted store needs. It throws on *access*, not on use, so a feature-detect has to be a real read
  inside a `try`. Returns `null` for "remember nothing" rather than taking the app down on boot.
- **`bakeAlphaField(size, sampler, options?)`** in `modules/assets` — the billboard-sheet bake: allocate an RGBA byte field, let the caller paint it, wrap it in a
  `DataTexture` with both wrap modes, both filters and the upload flag. Mirrored wrapping is the default because a sheet scrolled on wind reveals its own seam
  under plain `Repeat`. DOM-free like everything else in the module.

## 0.5.1

**The gesture layer gains a lifecycle, and loses a tap nobody made.**

`attachPointerGesture` described a gesture but never said when one began or ended, which left the two things a consumer most needs to do at a press — latch what
the gesture *means*, and stop whatever was driving the view automatically — with nowhere to go. An isometric scene migrating onto it found all of this by trying.

- **Added `onPressStart(x, y, event)` and `onPressEnd(event)`**, bracketing the whole gesture and firing once however many pointers join it. This is where a
  consumer latches which mouse button or modifier was held, focuses the element so it can take key events, or leaves a follow camera. A press is an act of intent
  even when it never becomes a drag: deciding on the first *move* makes press-and-hold do nothing, and re-reading modifiers per move makes releasing shift
  mid-drag change the verb underneath the reader's hand.
- **Fixed: a two-finger gesture could fire a tap nobody made.** The tap check runs when the *last* pointer leaves, but the press it measures against was recorded
  by the *first* — so a pinch ending near where it began, quickly enough, read as a tap. Now suppressed for any gesture that was ever more than one pointer, and
  the guard clears so the element still taps afterwards.
- **`onPinch` gained `panX`/`panY`**, how far the pinch centre travelled since the last move. A two-finger pinch is almost always a two-finger *drag* as well, and
  rederiving that from the absolute centre is a thing every caller would otherwise write for itself. **Breaking only for callers that assert on the exact
  arity** — the existing three arguments are unchanged and in the same positions.
- **Fixed: `lostpointercapture` did not end a pointer.** A capture lost to the browser — a system gesture, a finger dragged off the element — leaves a pointer
  that will never move again tracked forever, and the gesture open behind it.

**Cost:** nothing. One extra boolean of state per element, no new per-frame work, no new dependency.

## 0.5.0

**Seeing a geometry without a browser, and the ribbon three scenes kept rewriting.**

Six additions, all pulled up out of a consuming scene where they had proven
themselves, and all additive — no existing export changed shape.

- **`rasterizeAscii(geometry, options)` and `auditPalette(geometry, palette)`**
  (`modules/assets`) — an orthographic ASCII rasteriser with a real z-buffer,
  and a palette fingerprinter, both in pure TypeScript with no canvas, GPU or
  image file. This is the half of the authoring pipeline that was missing:
  `validatePropSpec` says whether a spec is legal and `reviewProp` measures
  whether the result floats or buries itself, but neither could say *what it
  looks like*, so a model authoring geometry had to reason blind. Six named
  views (`ASCII_VIEWS`), a ten-level ramp (`ASCII_SHADES`), ~10 ms per render.
  Both read `position` as a triangle soup, which is what `mergeParts` emits.
- **`createSurfaceRibbon(options)`, `traceSections(path, step)` and
  `ribbonIndices(first, sections, across)`** (`modules/assets`) — an open strip
  laid along a polyline and draped onto a surface: cart ruts, stream beds,
  footpaths, roads, shoreline foam. Distinct from `createPathTube`, which sweeps
  a closed profile through free space. The reason it has to exist is resolution:
  a feature narrower than the terrain's own vertex spacing cannot be painted
  into the terrain at all, because there are no vertices there to paint.
- **`box`, `cyl`, `cone`, `ball`, `hedron`, `plank`, `blade`, `deg`, `spread`**
  (`modules/assets`) — terse constructors for the primitives a low-poly prop is
  actually assembled from. At the density a prop builder uses them,
  `cyl(0.1, 0.12, 2.4, 5)` is readable where the constructor call is not. Every
  one is a factory, never a cached singleton, because `part()` bakes into what
  it is handed.
- **`valueNoise1d(at, span, phase)`** (root) — smooth 1D value noise over
  `hash2`. A hash is not a field, and anything jittered directly by one comes
  out as gravel rather than as a line that wanders; interpolating between whole
  cells is what makes it a field.
- **`readPath`, `writePath`, `readNumberPath`, `readTextPath`** (root) — total
  dotted-path access into a config object, so one string addresses the same leaf
  from a slider, a url parameter, a persisted snapshot and a headless capture
  flag. Every read and write is total: stale keys from a stored preference set
  must not take an app down on boot.
- **`disposeMesh(mesh, options)`** (root) — the counterpart to `disposeScene`,
  which walks a tree and deliberately leaves the root attached. A module that
  built one mesh wants the opposite. `keepMaterial` exempts a pooled material,
  and detaching from the parent is the line most often forgotten when this is
  written out by hand — a disposed mesh left in the graph still gets traversed.

**Cost:** nothing at runtime that is not called. All six are tree-shakeable pure
functions with no module-level state, no new dependency, and no peer-range
change (`three >= 0.160.0` as before). Bundle impact is zero unless imported.
58 new tests, 274 total.

**Also:** `build:watch` for developing against a linked consumer (`build` starts
with `rm -rf dist`, so a linked consumer resolves nothing mid-rebuild), and a
`publish` workflow on `workflow_dispatch` running the same `prepublishOnly`
chain, so releases stop depending on one machine.
