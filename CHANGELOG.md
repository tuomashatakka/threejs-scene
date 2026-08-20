# Changelog

Newest first. One entry per release: the headline, then what it costs a consumer.

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
