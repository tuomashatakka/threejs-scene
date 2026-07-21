import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { SceneContext, FrameContext } from 'Δ/index'
import type { EffectContext } from 'ꭍ/post'

// Real EffectComposer needs a live WebGL context, so we mock the composer
// factory and assert the module wires the handle correctly. Pixel output is
// out of scope for a headless test.
const { composerSpy, handle } = vi.hoisted(() => {
  const handle = {
    composer:            { render: vi.fn(), renderTarget1: { depthTexture: {}}},
    bloom:               { enabled: true, dispose: vi.fn() },
    output:              {},
    setSize:             vi.fn(),
    dispose:             vi.fn(),
    addPassBeforeOutput: vi.fn(),
  }
  return { composerSpy: vi.fn(() => handle), handle }
})

// mock path is relative to this test file so it resolves to the exact same
// module id as post/index.ts's own `./composer.js` import
vi.mock('../../modules/post/composer.js', () => ({ createComposer: composerSpy }))

const { postProcessing } = await import('ꭍ/post')

function fakeCtx (): SceneContext {
  return {
    scene:    new THREE.Scene(),
    camera:   new THREE.PerspectiveCamera(),
    renderer: { getSize: (v: THREE.Vector2) => v.set(800, 600) } as unknown as THREE.WebGLRenderer,
    rng:      {} as SceneContext['rng'],
    loop:     {} as SceneContext['loop'],
  }
}

const frame = (delta: number): FrameContext => ({ delta, elapsed: delta, frame: 1 })

describe('postProcessing', () => {
  it('is a pluggable AppModule with a render hook', () => {
    const mod = postProcessing()
    expect(mod.name).toBe('postprocessing')
    expect(typeof mod.build).toBe('function')
    expect(typeof mod.render).toBe('function')
    expect(typeof mod.resize).toBe('function')
    expect(typeof mod.dispose).toBe('function')
  })

  it('builds a composer sized to the renderer, bloom on by default', () => {
    composerSpy.mockClear()
    postProcessing().build(fakeCtx())

    expect(composerSpy).toHaveBeenCalledTimes(1)
    expect(composerSpy).toHaveBeenCalledWith(expect.objectContaining({
      width: 800, height: 600, withBloom: true, withDepth: false,
    }))
  })

  it('omits bloom and enables depth when configured', () => {
    composerSpy.mockClear()
    postProcessing({ bloom: false, depth: true }).build(fakeCtx())

    expect(composerSpy).toHaveBeenCalledWith(expect.objectContaining({ withBloom: false, withDepth: true }))
  })

  it('inserts custom effect passes before OutputPass', () => {
    handle.addPassBeforeOutput.mockClear()

    const passA = { enabled: true } as never
    const passB = { enabled: true } as never
    const mod   = postProcessing({ effects: () => [ passA, passB ]})
    mod.build(fakeCtx())

    expect(handle.addPassBeforeOutput).toHaveBeenCalledTimes(2)
    expect(handle.addPassBeforeOutput).toHaveBeenCalledWith(passA)
    expect(handle.addPassBeforeOutput).toHaveBeenCalledWith(passB)
  })

  it('render drives the composer with the frame delta', () => {
    handle.composer.render.mockClear()

    const mod = postProcessing()
    mod.build(fakeCtx())
    mod.render?.(frame(0.016), fakeCtx())

    expect(handle.composer.render).toHaveBeenCalledWith(0.016)
  })

  it('resize forwards to the composer and to resizable passes', () => {
    handle.setSize.mockClear()

    const setSize = vi.fn()
    const pass    = { enabled: true, setSize } as never
    const mod     = postProcessing({ effects: () => [ pass ]})
    mod.build(fakeCtx())
    mod.resize?.({ width: 1024, height: 768 }, fakeCtx())

    expect(handle.setSize).toHaveBeenCalledWith(1024, 768)
    expect(setSize).toHaveBeenCalledWith(1024, 768)
  })

  it('effects receives the composer and its depth texture', () => {
    let seen: EffectContext | undefined
    postProcessing({ effects: ctx => {
      seen = ctx; return []
    } }).build(fakeCtx())

    expect(seen?.composer).toBe(handle.composer)
    expect(seen?.depthTexture).toBe(handle.composer.renderTarget1.depthTexture)
    expect(seen?.width).toBe(800)
    expect(seen?.height).toBe(600)
  })

  it('onResize runs with the size and scene context', () => {
    const onResize = vi.fn()
    const mod      = postProcessing({ onResize })
    const ctx      = fakeCtx()
    mod.build(ctx)
    mod.resize?.({ width: 640, height: 480 }, ctx)

    expect(onResize).toHaveBeenCalledWith({ width: 640, height: 480 }, ctx)
  })

  it('dispose tears down passes, bloom, and the composer', () => {
    handle.dispose.mockClear()
    handle.bloom.dispose.mockClear()

    const dispose = vi.fn()
    const pass    = { enabled: true, dispose } as never
    const mod     = postProcessing({ effects: () => [ pass ]})
    mod.build(fakeCtx())
    mod.dispose?.()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(handle.bloom.dispose).toHaveBeenCalledTimes(1)
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })
})
