import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from 'Δ/index'
import { orbitControls } from 'ꭍ/orbit'


type Listener = (event: unknown) => void

class FakeCanvasElement {
  style = {} as CSSStyleDeclaration
  listeners = new Map<string, Set<Listener>>()

  addEventListener (type: string, fn: Listener): void {
    if (!this.listeners.has(type))
      this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener (type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  setPointerCapture (): void {}

  emit (type: string, event: object): void {
    for (const fn of this.listeners.get(type) ?? [])
      fn(event)
  }
}

function fixture (options: Parameters<typeof orbitControls>[0] = {}) {
  const el       = new FakeCanvasElement()
  const renderer = {
    render:     vi.fn(),
    setSize:    vi.fn(),
    compile:    vi.fn(),
    dispose:    vi.fn(),
    domElement: el,
  } as unknown as THREE.WebGLRenderer

  const app    = createApp({} as HTMLCanvasElement, { renderer })
  const handle = app.use(orbitControls(options))
  return { app, el, handle, camera: app.ctx.camera }
}

const pointer = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY })

describe('orbitControls', () => {
  it('rotates the camera around the target on drag, preserving radius', () => {
    const { app, el, camera } = fixture()
    const before              = camera.position.clone()
    const radius              = before.length()

    el.emit('pointerdown', pointer(1, 100, 100))
    el.emit('pointermove', pointer(1, 140, 100))

    expect(camera.position.equals(before)).toBe(false)
    expect(camera.position.length()).toBeCloseTo(radius, 6)
    app.dispose()
  })

  it('zooms with the wheel inside the radius clamp', () => {
    const { app, el, camera } = fixture({ radius: [ 2, 50 ]})
    const before              = camera.position.length()

    el.emit('wheel', { deltaY: 500, preventDefault: vi.fn() })
    expect(camera.position.length()).toBeGreaterThan(before)

    for (let i = 0; i < 50; i++)
      el.emit('wheel', { deltaY: 5000, preventDefault: vi.fn() })
    expect(camera.position.length()).toBeLessThanOrEqual(50 + 1e-9)
    app.dispose()
  })

  it('zooms with pinch gestures', () => {
    const { app, el, camera } = fixture()
    const before              = camera.position.length()

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 10, 0))
    el.emit('pointermove', pointer(2, 20, 0)) // pinch out, ratio 2 -> zoom in

    expect(camera.position.length()).toBeCloseTo(before / 2, 6)
    app.dispose()
  })

  it('orbits around a custom target', () => {
    const { app, el, camera } = fixture({ target: [ 0, 5, 0 ]})
    const target              = new THREE.Vector3(0, 5, 0)
    const before              = camera.position.clone().sub(target)
      .length()

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 30, 10))
    expect(camera.position.clone().sub(target)
      .length()).toBeCloseTo(before, 6)
    app.dispose()
  })

  it('detaches its listeners when removed', () => {
    const { app, el, handle, camera } = fixture()

    handle.remove()

    const before = camera.position.clone()
    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 40, 0))
    expect(camera.position.equals(before)).toBe(true)
    app.dispose()
  })
})
