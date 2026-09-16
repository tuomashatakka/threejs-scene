// lib/testing/index.ts
// The contract test kit. A rule nobody can check is a suggestion, so the four
// properties this package claims about a module — scoped, deterministic,
// unidirectional, leak-free — ship with the machinery to prove them about YOUR
// module, in a headless test, with no browser and no GPU.
//
//   import { auditModule } from 'threejs-scene/testing'
//
//   it('honours the module contract', () => {
//     expect(auditModule(myModule).ok).toBe(true)
//   })
//
// Framework-agnostic on purpose: it returns a report and never imports a test
// runner, so it works from vitest, node:test, or a script.

import * as THREE from 'three'

import { createApp } from '../app/create-app.js'
import { RuleSeverity } from '../llm/rules.js'
import { violationOf } from '../app/strict.js'
import { createSeededRng } from '../state/rng.js'
import { ModulePhase } from '../app/module.js'

import type { AnyAppModule, ModuleContext } from '../app/module.js'
import type { ModuleViolation, StrictOptions } from '../app/strict.js'
import type { App } from '../app/create-app.js'
import type { Size } from '../types.js'


/** A renderer stand-in: every method the app shell calls, none of the GPU. */
export function stubRenderer (overrides: Partial<THREE.WebGLRenderer> = {}): THREE.WebGLRenderer {
  const size = new THREE.Vector2(800, 600)

  return {
    domElement:          { style: {}, addEventListener () {}, removeEventListener () {} } as unknown as HTMLCanvasElement,
    render () {},
    compile () {},
    dispose () {},
    setSize () {},
    setPixelRatio () {},
    setRenderTarget () {},
    getSize:             (target: THREE.Vector2) => target.copy(size),
    getPixelRatio:       () => 1,
    getRenderTarget:     () => null,
    getContext:          () => null,
    shadowMap:           { enabled: false, type: THREE.PCFSoftShadowMap },
    toneMapping:         THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace:    THREE.SRGBColorSpace,
    info:                { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: []},
    capabilities:        { isWebGL2: true, maxTextureSize: 4096 },
    ...overrides,
  } as unknown as THREE.WebGLRenderer
}

/** A canvas stand-in with a fixed client size and no DOM behind it. */
export function stubCanvas ({ width = 800, height = 600 }: Partial<Size> = {}): HTMLCanvasElement {
  return {
    clientWidth:           width,
    clientHeight:          height,
    width,
    height,
    style:                 {},
    parentElement:         null,
    addEventListener () {},
    removeEventListener () {},
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  } as unknown as HTMLCanvasElement
}

/** Options for {@link headlessApp} and {@link auditModule}. */
export interface HeadlessOptions {

  /** @defaultValue 1 */
  seed?: number

  /** Initial app state. @defaultValue `{}` */
  state?: Record<string, unknown>

  /** Swap in a real renderer for modules that need one (PMREM, composers). */
  renderer?: THREE.WebGLRenderer

  /** Viewport for the stub canvas. @defaultValue 800×600 */
  size?: Partial<Size>

  /** Strict-mode overrides. Enforcement is on by default here. */
  strict?: StrictOptions
}

/**
 * A running app with no DOM and no GPU — the fixture almost every module test
 * wants. `dispose()` it when the test ends.
 *
 * @param options - See {@link HeadlessOptions}.
 * @returns An {@link App} whose violations array is the assertion target.
 * @example
 * const app = headlessApp({ seed: 7 })
 * app.use(myModule)
 * app.tick(1 / 60)
 * expect(app.violations).toEqual([])
 * app.dispose()
 */
export function headlessApp (options: HeadlessOptions = {}): App<Record<string, unknown>> {
  const collected: ModuleViolation[] = []

  return createApp<Record<string, unknown>>(stubCanvas(options.size), {
    state:    options.state ?? {},
    seed:     options.seed ?? 1,
    renderer: options.renderer ?? stubRenderer(),
    loop:     { fps: 0 },
    strict:   {
      enabled: true,
      report:  violation => collected.push(violation),
      ...options.strict,
    },
  })
}

/** What {@link testModuleContext} hands back alongside the context. */
export interface TestModuleContext {
  ctx:      ModuleContext
  owned:    unknown[]
  commits:  unknown[]
  cleanups: (() => void)[]
  provided: Map<string, unknown>
}

/**
 * Build a {@link ModuleContext} directly, for driving one hook without an app
 * around it. The scoped members are real — `root` is a live Group attached to a
 * live Scene, `rng` is seeded, `own`/`onCleanup`/`commit`/`provide` record into
 * the returned ledgers — so a unit test can assert what the hook allocated and
 * what it tried to write, without asserting on a whole app.
 *
 * @param overrides - Anything to swap in; most often `renderer` or `camera`.
 * @returns The context and the ledgers it writes to.
 * @example
 * const { ctx, owned } = testModuleContext()
 * myModule.build(ctx)
 * expect(owned).toHaveLength(2)
 */
export function testModuleContext (overrides: Partial<ModuleContext> = {}): TestModuleContext {
  const owned: unknown[]         = []
  const commits: unknown[]       = []
  const cleanups: (() => void)[] = []
  const provided                 = new Map<string, unknown>()
  const scene                    = new THREE.Scene()
  const root                     = new THREE.Group()

  root.name = 'test'
  scene.add(root)

  const ctx: ModuleContext = {
    scene,
    camera:   new THREE.PerspectiveCamera(),
    renderer: stubRenderer(),
    rng:      createSeededRng(1).fork('test'),
    loop:     {
      onFrame: () => () => {},
      start () {},
      stop () {},
      dispose () {},
      running: false,
    },
    id:     'test',
    name:   'test',
    root,
    size:   { width: 800, height: 600 },
    strict: true,
    own (resource) {
      owned.push(resource)
      return resource
    },
    onCleanup (cleanup) {
      cleanups.push(cleanup)
    },
    commit (patch) {
      commits.push(patch)
    },
    dispatch (action) {
      commits.push(action)
    },
    provide (token, value) {
      provided.set(token.name, value)
    },
    resolve (token) {
      if (!provided.has(token.name))
        throw new Error(`testModuleContext: nothing provides '${token.name}'`)

      return provided.get(token.name) as never
    },
    tryResolve (token) {
      return (provided.get(token.name) ?? null) as never
    },
    violation () {},
    violations: [],
    ...overrides,
  }

  return { ctx, owned, commits, cleanups, provided }
}

/** A resource the audit expected the module to release, and did not. */
export interface LeakedResource {
  kind: 'geometry' | 'material' | 'texture'
  name: string
}

/** What {@link auditModule} found. */
export interface ModuleAudit {

  /** No error-severity findings. */
  ok: boolean

  /** The module id the runtime assigned it. */
  id: string

  /** Contract violations strict mode reported during the run. */
  violations: readonly ModuleViolation[]

  /** GPU resources still undisposed after teardown (rule `SC005`). */
  leaks: readonly LeakedResource[]

  /** Scene children left behind after teardown (rule `SC004`). */
  strandedChildren: number

  /**
   * Whether two runs from the same seed produced the same scene. `false` means
   * something in the module is reading a clock or an unseeded random.
   */
  deterministic: boolean

  /** Every finding as a readable line, for a test failure message. */
  report: string
}

/**
 * A structural fingerprint of an object tree: names, types, transforms, and
 * geometry attribute sums. Two runs of a deterministic module produce the same
 * string; a module that reached for `Math.random` does not.
 *
 * @param root - The subtree to fingerprint.
 * @param precision - Decimal places transforms are rounded to. @defaultValue 4
 * @returns A newline-delimited fingerprint.
 */
export function snapshotObject (root: THREE.Object3D, precision = 4): string {
  const lines: string[] = []
  const round           = (value: number): string => value.toFixed(precision)

  root.traverse(object => {
    const mesh = object as THREE.Mesh

    lines.push([
      object.type,
      object.name,
      root.children.indexOf(object),
      round(object.position.x), round(object.position.y), round(object.position.z),
      round(object.quaternion.x), round(object.quaternion.y), round(object.quaternion.z), round(object.quaternion.w),
      round(object.scale.x), round(object.scale.y), round(object.scale.z),
      object.visible ? 1 : 0,
    ].join(','))

    if (!mesh.geometry)
      return

    for (const key of Object.keys(mesh.geometry.attributes).sort()) {
      const attribute = mesh.geometry.attributes[key] as THREE.BufferAttribute
      const array     = attribute.array as ArrayLike<number>
      let sum         = 0

      for (let index = 0; index < array.length; index++)
        sum += array[index]!

      lines.push(`  attr ${key} ${array.length} ${sum.toFixed(precision)}`)
    }
  })

  return lines.join('\n')
}

function collectResources (root: THREE.Object3D): { resource: { dispose (): void }, entry: LeakedResource }[] {
  const found: { resource: { dispose (): void }, entry: LeakedResource }[] = []
  const seen                                                               = new Set<object>()

  root.traverse(object => {
    const mesh = object as THREE.Mesh

    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry)
      found.push({ resource: mesh.geometry, entry: { kind: 'geometry', name: mesh.geometry.type }})
    }

    const materials = mesh.material
      ? Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
      : []

    for (const material of materials)
      if (!seen.has(material)) {
        seen.add(material)
        found.push({ resource: material, entry: { kind: 'material', name: material.name || material.type }})
      }
  })

  return found
}

/**
 * Run a module through its whole lifecycle twice in a headless app and report
 * every way it broke the contract: strict-mode violations, GPU resources it
 * never released, objects it left on the scene, and any difference between the
 * two runs from the same seed.
 *
 * This is the test to write for a module you intend to publish.
 *
 * @param factory - The module, or a factory called once per run. Pass a factory
 * when the module keeps closure state, which is almost always.
 * @param options - See {@link HeadlessOptions}; `ticks` sets how many frames to pump.
 * @returns A {@link ModuleAudit}.
 * @example
 * const audit = auditModule(() => standardLighting(), { renderer: realRenderer })
 * expect(audit.report).toBe('')
 */
export function auditModule (
  factory: AnyAppModule | (() => AnyAppModule),
  options: HeadlessOptions & { ticks?: number } = {},
): ModuleAudit {
  const ticks                         = options.ticks ?? 12
  const violations: ModuleViolation[] = []
  const make                          = (): AnyAppModule => typeof factory === 'function' ? factory() : factory

  type RunReturnType = { fingerprint: string, id: string, leaks: LeakedResource[], stranded: number }

  function run (): RunReturnType {
    const app = createApp<Record<string, unknown>>(stubCanvas(options.size), {
      state:    { ...options.state },
      seed:     options.seed ?? 1,
      renderer: options.renderer ?? stubRenderer(),
      loop:     { fps: 0 },
      strict:   { enabled: true, frames: ticks, report: violation => violations.push(violation), ...options.strict },
    })

    const baseline = app.ctx.scene.children.length
    const handle   = app.use(make())

    for (let tick = 0; tick < ticks; tick++)
      app.tick(1 / 60)

    app.runtime.resize({ width: 1024, height: 768 })

    const fingerprint = snapshotObject(handle.root)
    const tracked     = collectResources(handle.root)
    const disposed    = new Set<object>()

    for (const { resource } of tracked) {
      const original   = resource.dispose.bind(resource)
      resource.dispose = function tracedDispose () {
        disposed.add(resource)
        original()
      }
    }

    handle.remove()

    const leaks    = tracked.filter(({ resource }) => !disposed.has(resource)).map(({ entry }) => entry)
    const stranded = app.ctx.scene.children.length - baseline

    app.dispose()
    return { fingerprint, id: handle.id, leaks, stranded }
  }

  const first  = run()
  const second = run()

  const deterministic = first.fingerprint === second.fingerprint

  if (!deterministic)
    violations.push(violationOf(
      'SC002',
      first.id,
      'app',
      'produced a different scene on a second run from the same seed',
    ))

  for (const leak of first.leaks)
    violations.push(violationOf('SC005', first.id, ModulePhase.Dispose, `left a ${leak.kind} (${leak.name}) undisposed`))

  if (first.stranded > 0)
    violations.push(violationOf('SC004', first.id, ModulePhase.Dispose, `left ${first.stranded} object(s) on the scene after teardown`))

  const errors = violations.filter(entry => entry.severity === RuleSeverity.Error)

  return {
    ok:               errors.length === 0,
    id:               first.id,
    violations,
    leaks:            first.leaks,
    strandedChildren: first.stranded,
    deterministic,
    report:           violations.map(entry => entry.message).join('\n'),
  }
}
