import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachResizeObserver } from 'Δ/render/resize'


class FakeResizeObserver {
  static instance: FakeResizeObserver | null = null

  callback: ResizeObserverCallback
  observed: unknown[] = []
  disconnected = false

  constructor (callback: ResizeObserverCallback) {
    this.callback               = callback
    FakeResizeObserver.instance = this
  }

  observe (el: unknown): void {
    this.observed.push(el)
  }

  disconnect (): void {
    this.disconnected = true
  }

  trigger (width: number, height: number): void {
    const entry = { contentRect: { width, height }} as ResizeObserverEntry
    this.callback([ entry ], this as unknown as ResizeObserver)
  }
}

function makeFixture () {
  const renderer = { setSize: vi.fn() } as unknown as THREE.WebGLRenderer
  const camera   = new THREE.PerspectiveCamera(50, 1)
  const parent   = {}
  const canvas   = { parentElement: parent } as unknown as HTMLCanvasElement
  return { renderer, camera, parent, canvas }
}

afterEach(() => {
  FakeResizeObserver.instance = null
  vi.unstubAllGlobals()
})

describe('attachResizeObserver', () => {
  it('is a no-op when ResizeObserver is unavailable', () => {
    const { renderer, camera, canvas } = makeFixture()
    const detach                       = attachResizeObserver(renderer, camera, canvas)
    expect(() => detach()).not.toThrow()
  })

  it('observes the canvas parent and syncs renderer + camera on resize', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const { renderer, camera, parent, canvas } = makeFixture()
    const onResize                             = vi.fn()

    attachResizeObserver(renderer, camera, canvas, onResize)

    const ro = FakeResizeObserver.instance!
    expect(ro.observed).toEqual([ parent ])

    ro.trigger(800, 400)
    expect(renderer.setSize).toHaveBeenCalledWith(800, 400, false)
    expect(camera.aspect).toBe(2)
    expect(onResize).toHaveBeenCalledWith(800, 400)
  })

  it('leaves non-perspective cameras untouched', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const { renderer, canvas } = makeFixture()
    const ortho                = new THREE.OrthographicCamera()
    const spy                  = vi.spyOn(ortho, 'updateProjectionMatrix')

    attachResizeObserver(renderer, ortho, canvas)
    FakeResizeObserver.instance!.trigger(100, 50)
    expect(spy).not.toHaveBeenCalled()
  })

  it('detach disconnects the observer', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const { renderer, camera, canvas } = makeFixture()

    const detach = attachResizeObserver(renderer, camera, canvas)
    detach()
    expect(FakeResizeObserver.instance!.disconnected).toBe(true)
  })
})
