// The four guarantees the runtime makes, each asserted rather than described:
// scoped, unidirectional, deterministic, and enforced. A guarantee nobody tests
// is a comment.

import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { capability, createApp, defineModule, defineScopedModule } from 'Δ/index'
import { resolveOrder } from 'Δ/app/runtime'
import { auditModule, snapshotObject, stubCanvas, stubRenderer } from 'Δ/testing/index'

import type { App, AppModule, ModuleViolation } from 'Δ/index'


interface State {
  speed: number
}

/** An app whose violations are collected instead of printed. */
type MakeAppReturnType = { app: App<State>, violations: ModuleViolation[] }

function makeApp (
  extra: Parameters<typeof createApp<State>>[1] = {},
): MakeAppReturnType {
  const violations: ModuleViolation[] = []

  const app = createApp<State>(stubCanvas(), {
    state:       { speed: 1 },
    renderer:    stubRenderer(),
    loop:        { fps: 0 },
    onViolation: violation => violations.push(violation),
    ...extra,
  })

  return { app, violations }
}

const codes = (violations: readonly ModuleViolation[]): string[] => violations.map(entry => entry.code)

describe('scoped', () => {
  it('gives every module its own root, attached to the scene and named by id', () => {
    const { app } = makeApp()
    const first   = app.use(defineModule<State>({ name: 'a', build: () => {} }))
    const second  = app.use(defineModule<State>({ name: 'b', build: () => {} }))

    expect(first.root.parent).toBe(app.ctx.scene)
    expect(first.root.name).toBe('a')
    expect(second.root.name).toBe('b')
    expect(app.ctx.scene.children).toContain(first.root)
    app.dispose()
  })

  it('disposes owned resources in reverse order, after the cleanups', () => {
    const order: string[] = []
    const { app }         = makeApp()

    const handle = app.use(defineModule<State>({
      name: 'owner',
      build (ctx) {
        ctx.own(() => order.push('owned-first'))
        ctx.own(() => order.push('owned-second'))
        ctx.onCleanup(() => order.push('cleanup'))
      },
      dispose: () => order.push('dispose'),
    }))

    handle.remove()

    // dispose, then cleanups, then owned resources newest-first — the exact
    // inverse of the order they were registered in
    expect(order).toEqual([ 'dispose', 'cleanup', 'owned-second', 'owned-first' ])
    app.dispose()
  })

  it('detaches, empties and disposes the root when a module is removed', () => {
    const geometry = new THREE.BoxGeometry()
    const spy      = vi.spyOn(geometry, 'dispose')
    const { app }  = makeApp()

    const handle = app.use(defineModule<State>({
      name: 'mesh',
      build (ctx) {
        ctx.root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
      },
    }))

    expect(handle.root.children).toHaveLength(1)

    handle.remove()

    expect(handle.mounted).toBe(false)
    expect(handle.root.parent).toBeNull()
    expect(handle.root.children).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    app.dispose()
  })

  it('adopts objects added straight to the scene, and says so', () => {
    const { app, violations } = makeApp()
    const stray               = new THREE.Group()

    const handle = app.use(defineModule<State>({
      name:  'sloppy',
      build: ctx => ctx.scene.add(stray),
    }))

    expect(codes(violations)).toContain('SC004')

    // reported, but still torn down — ownership is not optional
    handle.remove()
    expect(stray.parent).toBeNull()
    app.dispose()
  })

  it('gives a repeated name its own id and its own rng stream', () => {
    const draws: number[]     = []
    const { app, violations } = makeApp()

    const sampler = (): AppModule<State> => ({
      name:  'props',
      build: ctx => draws.push(ctx.rng.next()),
    })

    const first  = app.use(sampler())
    const second = app.use(sampler())

    expect(first.id).toBe('props')
    expect(second.id).toBe('props#2')
    expect(draws[0]).not.toBe(draws[1])
    expect(codes(violations)).toContain('SC016')
    app.dispose()
  })
})

describe('unidirectional', () => {
  it('drains commits after every module has updated, not mid-tick', () => {
    const seen: number[] = []

    const writer = defineScopedModule<{ counter: { n: number }}, 'counter'>(
      'counter',
      { n: 0 },
      {
        name:   'writer',
        build:  () => {},
        update: (counter, _frame, ctx) => ctx.commit({ n: counter.n + 1 }),
      },
    )

    const reader = defineModule<{ counter: { n: number }}>({
      name:   'reader',
      build:  () => {},
      update: state => seen.push(state.counter.n),
    })

    const app = createApp<{ counter: { n: number }}>(stubCanvas(), {
      state:    { counter: { n: 0 }},
      renderer: stubRenderer(),
      loop:     { fps: 0 },
      use:      [ writer, reader ],
    })

    app.tick(1 / 60)
    app.tick(1 / 60)
    app.tick(1 / 60)

    // the reader runs AFTER the writer every tick and still sees the pre-commit
    // value: the write landed at the boundary, so both modules saw one world
    expect(seen).toEqual([ 0, 1, 2 ])
    expect(app.getState().counter.n).toBe(3)
    app.dispose()
  })

  it('merges contiguous commits into one store notification', () => {
    const listener = vi.fn()

    const writer = (name: string) =>
      defineScopedModule<{ box: { a: number, b: number }}, 'box'>('box', { a: 0, b: 0 }, {
        name,
        build:  () => {},
        update: (_box, _frame, ctx) => ctx.commit(name === 'x' ? { a: 1 } : { b: 2 }),
      })

    const app = createApp<{ box: { a: number, b: number }}>(stubCanvas(), {
      state:    { box: { a: 0, b: 0 }},
      renderer: stubRenderer(),
      loop:     { fps: 0 },
      use:      [ writer('x'), writer('y') ],
    })

    app.store.subscribe(listener)
    app.tick(1 / 60)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(app.getState().box).toEqual({ a: 1, b: 2 })
    app.dispose()
  })

  it('refuses a commit from a module that owns no state key', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:   'greedy',
      build:  () => {},
      update: (_state, _frame, ctx) => (ctx.commit as (patch: unknown) => void)({ speed: 99 }),
    }))

    app.tick(1 / 60)

    expect(codes(violations)).toContain('SC007')
    expect(app.getState().speed).toBe(1)
    app.dispose()
  })

  it('freezes the state view, so a module cannot write through it', () => {
    let thrown: unknown

    const { app } = makeApp()

    app.use(defineModule<State>({
      name:  'mutator',
      build: () => {},
      update (state) {
        try {
          (state as { speed: number }).speed = 99
        }
        catch (error) {
          thrown = error
        }
      },
    }))

    app.tick(1 / 60)

    expect(thrown).toBeInstanceOf(TypeError)
    expect(app.getState().speed).toBe(1)
    app.dispose()
  })

  it('reports and drops setState called from inside a lifecycle hook', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:   'escapee',
      build:  () => {},
      update: () => app.setState({ speed: 99 }),
    }))

    app.tick(1 / 60)

    expect(codes(violations)).toContain('SC006')
    expect(app.getState().speed).toBe(1)
    app.dispose()
  })

  it('seeds a scoped module state key before the module builds', () => {
    let atBuild: unknown

    const app = createApp<{ hud: { score: number }}>(stubCanvas(), {
      renderer: stubRenderer(),
      loop:     { fps: 0 },
      use:      [
        defineScopedModule<{ hud: { score: number }}, 'hud'>('hud', { score: 7 }, {
          name:  'hud',
          build: () => {},
        }),
        defineModule<{ hud: { score: number }}>({
          name:   'observer',
          build:  _ctx => {},
          update: state => {
            atBuild ??= state.hud
          },
        }),
      ],
    })

    app.tick(1 / 60)
    expect(atBuild).toEqual({ score: 7 })
    app.dispose()
  })
})

describe('deterministic', () => {
  const entry = (name: string, order = 0, provides: string[] = [], requires: string[] = []) => ({
    id:     name,
    index:  0,
    module: { name, order, provides, requires, build: () => {} },
  })

  it('keeps insertion order when nothing declares a dependency', () => {
    const list = [ entry('a'), entry('b'), entry('c') ].map((item, index) => ({ ...item, index }))

    expect(resolveOrder(list as never).map(item => item.id)).toEqual([ 'a', 'b', 'c' ])
  })

  it('puts providers before consumers, disturbing the listed order as little as possible', () => {
    const list = [
      { ...entry('consumer', 0, [], [ 'physics' ]), index: 0 },
      { ...entry('unrelated'), index: 1 },
      { ...entry('provider', 0, [ 'physics' ]), index: 2 },
    ]

    const order = resolveOrder(list as never).map(item => item.id)

    // the dependency is satisfied, and nothing else moved further than it had
    // to: `unrelated` is emitted as soon as it is reachable rather than being
    // held behind a constraint that has nothing to do with it
    expect(order.indexOf('provider')).toBeLessThan(order.indexOf('consumer'))
    expect(order).toEqual([ 'unrelated', 'provider', 'consumer' ])
  })

  it('applies the order band before the dependency sort', () => {
    const list = [
      { ...entry('post', 100), index: 0 },
      { ...entry('input', -100), index: 1 },
      { ...entry('middle'), index: 2 },
    ]

    expect(resolveOrder(list as never).map(item => item.id)).toEqual([ 'input', 'middle', 'post' ])
  })

  it('reports an unsatisfiable cycle instead of hanging', () => {
    const stuck: string[] = []
    const list            = [
      { ...entry('a', 0, [ 'x' ], [ 'y' ]), index: 0 },
      { ...entry('b', 0, [ 'y' ], [ 'x' ]), index: 1 },
    ]

    const out = resolveOrder(list as never, node => stuck.push(node.id))

    expect(out).toHaveLength(2)
    expect(stuck.length).toBeGreaterThan(0)
  })

  it('forks the rng by module id, so a module is stable beside its neighbours', () => {
    const run = (extra: boolean): number => {
      const { app } = makeApp({ seed: 42 })
      let drawn     = 0

      if (extra)
        app.use(defineModule<State>({ name: 'noise', build: ctx => void ctx.rng.next() }))

      app.use(defineModule<State>({ name: 'trees', build: ctx => void (drawn = ctx.rng.next()) }))
      app.dispose()
      return drawn
    }

    // adding a module before it must not change what `trees` draws
    expect(run(false)).toBe(run(true))
  })

  it('reproduces the same world from the same seed and tick sequence', () => {
    const record = (): string => {
      const { app } = makeApp({ seed: 9, clock: { mode: 'fixed', step: 1 / 120 }})

      const handle = app.use(defineModule<State>({
        name: 'scatter',
        build (ctx) {
          const jitter = ctx.rng.fork('scatter')

          for (let index = 0; index < 8; index++) {
            const mesh = ctx.own(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))

            mesh.position.set(jitter.range(-5, 5), 0, jitter.range(-5, 5))
            ctx.root.add(mesh)
          }
        },
        update: (_state, frame, ctx) => void (ctx.root.rotation.y = frame.elapsed),
      }))

      for (const delta of [ 0.016, 0.02, 0.031 ])
        app.tick(delta)

      const fingerprint = snapshotObject(handle.root)

      app.dispose()
      return fingerprint
    }

    expect(record()).toEqual(record())
  })
})

describe('capabilities', () => {
  const Turbine = capability<{ rpm (): number }>('turbine')

  it('publishes a value one module can resolve from another', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:     'engine',
      provides: [ Turbine ],
      build:    ctx => ctx.provide(Turbine, { rpm: () => 1200 }),
    }))

    let seen = 0

    app.use(defineModule<State>({
      name:     'governor',
      requires: [ Turbine ],
      build:    () => {},
      start:    ctx => void (seen = ctx.resolve(Turbine).rpm()),
    }))

    expect(seen).toBe(1200)
    expect(app.resolve(Turbine).rpm()).toBe(1200)
    expect(violations).toEqual([])
    app.dispose()
  })

  it('orders a provider before its consumer whatever order they were listed in', () => {
    const app = createApp<State>(stubCanvas(), {
      state:    { speed: 1 },
      renderer: stubRenderer(),
      loop:     { fps: 0 },
      use:      [
        defineModule<State>({ name: 'governor', requires: [ Turbine ], build: () => {} }),
        defineModule<State>({
          name:     'engine',
          provides: [ Turbine ],
          build:    ctx => ctx.provide(Turbine, { rpm: () => 1 }),
        }),
      ],
    })

    expect(app.modules).toEqual([ 'engine', 'governor' ])
    app.dispose()
  })

  it('reports a declared capability that was never published', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({ name: 'liar', provides: [ Turbine ], build: () => {} }))

    expect(codes(violations)).toContain('SC010')
    app.dispose()
  })

  it('reports an undeclared resolve', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:     'engine',
      provides: [ Turbine ],
      build:    ctx => ctx.provide(Turbine, { rpm: () => 1 }),
    }))

    app.use(defineModule<State>({
      name:  'sneak',
      build: ctx => void ctx.resolve(Turbine),
    }))

    expect(codes(violations)).toContain('SC009')
    app.dispose()
  })

  it('withdraws a capability when its provider is removed', () => {
    const { app } = makeApp()

    const handle = app.use(defineModule<State>({
      name:     'engine',
      provides: [ Turbine ],
      build:    ctx => ctx.provide(Turbine, { rpm: () => 1 }),
    }))

    expect(app.tryResolve(Turbine)).not.toBeNull()

    handle.remove()

    expect(app.tryResolve(Turbine)).toBeNull()
    expect(() => app.resolve(Turbine)).toThrow(/no module provides/u)
    app.dispose()
  })
})

describe('enforcement', () => {
  it('attributes Math.random in build to the module that called it', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:  'gambler',
      build: () => void Math.random(),
    }))

    const found = violations.find(entry => entry.code === 'SC002')

    expect(found).toBeDefined()
    expect(found?.module).toBe('gambler')
    expect(found?.message).toContain('Math.random')
    app.dispose()
  })

  it('leaves Math.random alone once the phase is over', () => {
    const { app } = makeApp()

    app.use(defineModule<State>({ name: 'quiet', build: () => {} }))

    // the trap is installed per phase invocation and restored after it, so the
    // global the rest of the page sees is the real one
    expect(typeof Math.random()).toBe('number')
    app.dispose()
  })

  it('reports a module whose root keeps growing every tick', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:   'hoarder',
      build:  () => {},
      update: (_state, _frame, ctx) => void ctx.root.add(new THREE.Group()),
    }))

    for (let tick = 0; tick < 6; tick++)
      app.tick(1 / 60)

    expect(codes(violations)).toContain('SC012')
    app.dispose()
  })

  it('reports an async lifecycle hook', () => {
    const { app, violations } = makeApp()

    app.use(defineModule<State>({
      name:  'awaiter',
      build: () => Promise.resolve() as unknown as void,
    }))

    expect(codes(violations)).toContain('SC017')
    app.dispose()
  })

  it('refuses a module that subscribes to the frame loop', () => {
    const { app, violations } = makeApp()
    let unsubscribe: (() => void) | null = null

    app.use(defineModule<State>({
      name:  'looper',
      build: ctx => void (unsubscribe = ctx.loop.onFrame(() => {})),
    }))

    expect(codes(violations)).toContain('SC001')
    expect(typeof unsubscribe).toBe('function') // a no-op, so the module still runs
    app.dispose()
  })

  it('stays quiet when strict mode is off', () => {
    const violations: ModuleViolation[] = []

    const app = createApp<State>(stubCanvas(), {
      state:       { speed: 1 },
      renderer:    stubRenderer(),
      loop:        { fps: 0 },
      strict:      false,
      onViolation: violation => violations.push(violation),
    })

    app.use(defineModule<State>({
      name: 'gambler',
      build (ctx) {
        // two error-severity breaches that strict mode would report
        ctx.scene.add(new THREE.Group())
        Math.random()
      },
    }))

    expect(violations).toEqual([])
    app.dispose()
  })
})

describe('auditModule', () => {
  it('passes a module that honours the contract', () => {
    const clean = () => defineModule({
      name: 'clean',
      build (ctx) {
        const mesh = ctx.own(new THREE.Mesh(
          ctx.own(new THREE.BoxGeometry()),
          ctx.own(new THREE.MeshBasicMaterial()),
        ))

        mesh.position.x = ctx.rng.fork('place').range(-1, 1)
        ctx.root.add(mesh)
      },
      update: (_state, frame, ctx) => void (ctx.root.rotation.y = frame.elapsed),
    })

    const audit = auditModule(clean, { seed: 3 })

    expect(audit.report).toBe('')
    expect(audit.ok).toBe(true)
    expect(audit.deterministic).toBe(true)
    expect(audit.leaks).toEqual([])
  })

  it('catches a module that is not reproducible', () => {
    const drifting = () => defineModule({
      name: 'drifting',
      build (ctx) {
        const mesh = ctx.own(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))

        mesh.position.x = Math.random()
        ctx.root.add(mesh)
      },
    })

    const audit = auditModule(drifting, { seed: 3 })

    expect(audit.deterministic).toBe(false)
    expect(audit.ok).toBe(false)
    expect(audit.report).toContain('SC002')
  })
})

describe('simulation time', () => {
  it('gives every sub-step of one pump its own elapsed', () => {
    const seen: number[] = []
    const { app }        = makeApp({ clock: { mode: 'fixed', step: 0.01 }})

    app.use(defineModule<State>({
      name:   'stopwatch',
      build:  () => {},
      update: (_state, frame) => seen.push(Number(frame.elapsed.toFixed(4))),
    }))

    // one pump, three sub-steps: time must advance across them, not jump to the
    // end of the pump and repeat
    app.tick(0.035)

    expect(seen).toEqual([ 0.01, 0.02, 0.03 ])
    app.dispose()
  })

  it('keeps sub-step time continuous across pumps', () => {
    const seen: number[] = []
    const { app }        = makeApp({ clock: { mode: 'fixed', step: 0.01 }})

    app.use(defineModule<State>({
      name:   'stopwatch',
      build:  () => {},
      update: (_state, frame) => seen.push(Number(frame.elapsed.toFixed(4))),
    }))

    app.tick(0.025)
    app.tick(0.025)

    expect(seen).toEqual([ 0.01, 0.02, 0.03, 0.04, 0.05 ])
    app.dispose()
  })
})
