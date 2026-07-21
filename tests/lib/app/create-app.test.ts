import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from 'Δ/app/create-app'
import { defineModule } from 'Δ/app/module'

import type { FrameContext, SceneContext } from 'Δ/types'


interface State {
  speed: number
}

type Action = { type: 'faster' }

function fakeRenderer (): THREE.WebGLRenderer {
  return {
    render:     vi.fn(),
    setSize:    vi.fn(),
    compile:    vi.fn(),
    dispose:    vi.fn(),
    domElement: {},
  } as unknown as THREE.WebGLRenderer
}

function canvas (): HTMLCanvasElement {
  return {} as HTMLCanvasElement
}

function makeApp (extra: Parameters<typeof createApp<State, Action>>[1] = {}) {
  return createApp<State, Action>(canvas(), {
    state:    { speed: 1 },
    renderer: fakeRenderer(),
    ...extra,
  })
}

describe('createApp', () => {
  it('throws without a canvas', () => {
    expect(() => createApp(undefined as unknown as HTMLCanvasElement)).toThrow(/canvas required/)
  })

  it('assembles the scene context with defaults', () => {
    const app = makeApp()
    expect(app.ctx.scene).toBeInstanceOf(THREE.Scene)
    expect((app.ctx.camera as THREE.PerspectiveCamera).isPerspectiveCamera).toBe(true)
    expect((app.ctx.camera as THREE.PerspectiveCamera).fov).toBe(50)
    expect(typeof app.ctx.rng.next).toBe('function')
    expect(app.running).toBe(false)
    app.dispose()
  })

  it('applies camera options and accepts prebuilt cameras', () => {
    const optioned = makeApp({ camera: { fov: 70, position: [ 0, 0, 10 ]}})
    expect((optioned.ctx.camera as THREE.PerspectiveCamera).fov).toBe(70)
    expect(optioned.ctx.camera.position.z).toBe(10)
    optioned.dispose()

    const ortho    = new THREE.OrthographicCamera()
    const prebuilt = makeApp({ camera: ortho })
    expect(prebuilt.ctx.camera).toBe(ortho)
    prebuilt.dispose()
  })

  it('builds initial modules immediately and updates them per tick', () => {
    const build  = vi.fn((ctx: SceneContext) => ctx.scene.add(new THREE.Group()))
    const update = vi.fn()
    const app    = makeApp({ use: [ defineModule<State>({ name: 'a', build, update }) ]})

    expect(build).toHaveBeenCalledTimes(1)
    app.tick(1 / 60)
    expect(update).toHaveBeenCalledTimes(1)

    const [ state, frame ] = update.mock.calls[0] as [ State, FrameContext ]
    expect(state).toEqual({ speed: 1 })
    expect(frame.frame).toBe(1)
    app.dispose()
  })

  it('runs 0..n sim ticks per pump but renders exactly once', () => {
    const update   = vi.fn()
    const renderer = fakeRenderer()
    const app      = createApp<State>(canvas(), {
      state: { speed: 1 },
      renderer,
      clock: { mode: 'fixed', step: 0.01 },
      use:   [ defineModule<State>({ name: 'a', build: () => {}, update }) ],
    })

    app.tick(0.035)
    expect(update).toHaveBeenCalledTimes(3)
    expect(renderer.render).toHaveBeenCalledTimes(1)

    app.tick(0.001)
    expect(update).toHaveBeenCalledTimes(3)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    app.dispose()
  })

  it('same seed + same tick sequence produce identical worlds', () => {
    const record = () => {
      const values: number[] = []
      const app              = makeApp({
        seed:  9,
        clock: { mode: 'fixed', step: 1 / 120 },
        use:   [ defineModule<State>({
          name:  'sampler',
          build: () => {},
          update (_state, frame, ctx) {
            values.push(frame.elapsed, ctx.rng.fork('sampler').next())
          },
        }) ],
      })
      for (const delta of [ 0.016, 0.02, 0.031 ])
        app.tick(delta)
      app.dispose()
      return values
    }
    expect(record()).toEqual(record())
  })

  it('setState flows into the next update; dispatch requires a reducer', () => {
    const seen: number[] = []
    const app            = makeApp({
      reducer: (state, action) => action.type === 'faster' ? { speed: state.speed + 1 } : state,
      use:     [ defineModule<State>({
        name:   'watcher',
        build:  () => {},
        update: state => seen.push(state.speed),
      }) ],
    })

    app.tick()
    app.setState({ speed: 5 })
    app.tick()
    app.dispatch({ type: 'faster' })
    app.tick()
    expect(seen).toEqual([ 1, 5, 6 ])
    app.dispose()

    const reducerless = makeApp()
    expect(() => reducerless.dispatch({ type: 'faster' })).toThrow(/no reducer/)
    reducerless.dispose()
  })

  it('use() adds modules at runtime and handles remove them', () => {
    const app     = makeApp()
    const update  = vi.fn()
    const dispose = vi.fn()
    const handle  = app.use(defineModule<State>({ name: 'late', build: () => {}, update, dispose }))

    app.tick()
    expect(update).toHaveBeenCalledTimes(1)

    handle.remove()
    expect(dispose).toHaveBeenCalledTimes(1)
    app.tick()
    expect(update).toHaveBeenCalledTimes(1)
    app.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('a custom render replaces the default renderer.render', () => {
    const render   = vi.fn()
    const renderer = fakeRenderer()
    const app      = createApp(canvas(), { renderer, render })

    app.tick(0.02)
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ delta: 0.02 }))
    expect(renderer.render).not.toHaveBeenCalled()
    app.dispose()
  })

  it("a module's render hook replaces the default renderer.render", () => {
    const render   = vi.fn()
    const renderer = fakeRenderer()
    const app      = createApp<State>(canvas(), {
      renderer,
      use: [ defineModule<State>({ name: 'post', build: () => {}, render }) ],
    })

    app.tick(0.03)
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ delta: 0.03 }), app.ctx)
    expect(renderer.render).not.toHaveBeenCalled()
    app.dispose()
  })

  it('AppOptions.render takes precedence over a module render hook', () => {
    const optionRender = vi.fn()
    const moduleRender = vi.fn()
    const app          = createApp<State>(canvas(), {
      renderer: fakeRenderer(),
      render:   optionRender,
      use:      [ defineModule<State>({ name: 'post', build: () => {}, render: moduleRender }) ],
    })

    app.tick()
    expect(optionRender).toHaveBeenCalledTimes(1)
    expect(moduleRender).not.toHaveBeenCalled()
    app.dispose()
  })

  it('falls back to renderer.render after a render-owning module is removed', () => {
    const render   = vi.fn()
    const renderer = fakeRenderer()
    const app      = createApp<State>(canvas(), { renderer })
    const handle   = app.use(defineModule<State>({ name: 'post', build: () => {}, render }))

    app.tick()
    expect(render).toHaveBeenCalledTimes(1)
    expect(renderer.render).not.toHaveBeenCalled()

    handle.remove()
    app.tick()
    expect(render).toHaveBeenCalledTimes(1) // no longer driven
    expect(renderer.render).toHaveBeenCalledTimes(1) // default restored
    app.dispose()
  })

  it('dispose tears down modules in reverse order, then scene and renderer', () => {
    const order: string[] = []
    const renderer        = fakeRenderer()
    const geometry        = new THREE.BoxGeometry()
    const geoSpy          = vi.spyOn(geometry, 'dispose')
    const app             = createApp<State>(canvas(), {
      state: { speed: 1 },
      renderer,
      use:   [
        defineModule<State>({ name: 'first', build: ctx => ctx.scene.add(new THREE.Mesh(geometry)), dispose: () => order.push('first') }),
        defineModule<State>({ name: 'second', build: () => {}, dispose: () => order.push('second') }),
      ],
    })

    app.dispose()
    expect(order).toEqual([ 'second', 'first' ])
    expect(geoSpy).toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalled()
    expect(app.running).toBe(false)
  })
})
