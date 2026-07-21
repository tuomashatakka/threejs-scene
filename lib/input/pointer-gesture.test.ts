import { describe, expect, it, vi } from 'vitest'

import { attachPointerGesture } from './pointer-gesture.js'


type Listener = (event: unknown) => void

class FakeElement {
  style = {} as CSSStyleDeclaration
  listeners = new Map<string, Set<Listener>>()
  captured: number[] = []

  addEventListener (type: string, fn: Listener): void {
    if (!this.listeners.has(type))
      this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener (type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  setPointerCapture (id: number): void {
    this.captured.push(id)
  }

  emit (type: string, event: object): void {
    for (const fn of this.listeners.get(type) ?? [])
      fn(event)
  }
}

function pointer (pointerId: number, clientX: number, clientY: number) {
  return { pointerId, clientX, clientY }
}

function attach (callbacks: Parameters<typeof attachPointerGesture>[1]) {
  const el     = new FakeElement()
  const detach = attachPointerGesture(el as unknown as HTMLElement, callbacks)
  return { el, detach }
}

describe('attachPointerGesture', () => {
  it('disables native touch handling on the element', () => {
    const { el } = attach({})
    expect(el.style.touchAction).toBe('none')
  })

  it('fires onDrag with per-move deltas for a single pointer', () => {
    const onDrag = vi.fn()
    const { el } = attach({ onDrag })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 5, 3))
    el.emit('pointermove', pointer(1, 7, 2))

    expect(onDrag).toHaveBeenNthCalledWith(1, 5, 3, expect.anything())
    expect(onDrag).toHaveBeenNthCalledWith(2, 2, -1, expect.anything())
    expect(el.captured).toEqual([ 1 ])
  })

  it('fires onPinch with the distance ratio and center for two pointers', () => {
    const onPinch = vi.fn()
    const { el }  = attach({ onPinch })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 10, 0))
    el.emit('pointermove', pointer(2, 20, 0))

    expect(onPinch).toHaveBeenCalledWith(2, 10, 0)
  })

  it('fires onTap for a quick press without movement', () => {
    const onTap  = vi.fn()
    const { el } = attach({ onTap })

    el.emit('pointerdown', pointer(1, 4, 5))
    el.emit('pointerup', pointer(1, 4, 5))
    expect(onTap).toHaveBeenCalledWith(4, 5, expect.anything())
  })

  it('does not fire onTap after a drag past the movement threshold', () => {
    const onTap  = vi.fn()
    const { el } = attach({ onTap })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 50, 0))
    el.emit('pointerup', pointer(1, 50, 0))
    expect(onTap).not.toHaveBeenCalled()
  })

  it('fires onWheel with deltaY and prevents default', () => {
    const onWheel = vi.fn()
    const { el }  = attach({ onWheel })
    const event   = { deltaY: 42, preventDefault: vi.fn() }

    el.emit('wheel', event)
    expect(onWheel).toHaveBeenCalledWith(42, event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('detach removes every listener', () => {
    const onDrag         = vi.fn()
    const onWheel        = vi.fn()
    const { el, detach } = attach({ onDrag, onWheel })

    detach()
    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 5, 5))
    el.emit('wheel', { deltaY: 1, preventDefault: vi.fn() })

    expect(onDrag).not.toHaveBeenCalled()
    expect(onWheel).not.toHaveBeenCalled()
    expect([ ...el.listeners.values() ].every(set => set.size === 0)).toBe(true)
  })
})
