# Changelog

Newest first. One entry per release: the headline, then what it costs a consumer.

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
