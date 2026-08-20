import { describe, expect, it, vi } from 'vitest'

import { attachPointerGesture } from 'Δ/input/pointer-gesture'


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

    // The centre travelled from 5 to 10 while the fingers spread, so a pinch
    // carries a pan as well — which is what a two-finger gesture on a map is.
    expect(onPinch).toHaveBeenCalledWith(2, 10, 0, 5, 0)
  })

  it('reports the pinch centre travelling as the fingers move', () => {
    const onPinch = vi.fn()
    const { el }  = attach({ onPinch })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 10, 0))
    el.emit('pointermove', pointer(1, 4, 0))
    el.emit('pointermove', pointer(2, 14, 0))

    // Fingers arrive one event at a time, so a two-finger drag is a sequence of
    // lopsided moves: the gap closes to 6 and opens back to 10. Each step
    // carries its own ratio, and the centre walks 2 with every one of them.
    const calls = onPinch.mock.calls

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual([ 0.6, 7, 0, 2, 0 ])
    expect(calls[1]?.[3]).toBe(2)

    // Net over the whole gesture: the fingers ended as far apart as they began.
    expect(calls[0]![0] * calls[1]![0]).toBeCloseTo(1)
  })

  it('brackets a gesture with onPressStart and onPressEnd', () => {
    const onPressStart = vi.fn()
    const onPressEnd   = vi.fn()
    const { el }       = attach({ onPressStart, onPressEnd })

    el.emit('pointerdown', pointer(1, 3, 4))
    expect(onPressStart).toHaveBeenCalledWith(3, 4, expect.anything())
    expect(onPressEnd).not.toHaveBeenCalled()

    el.emit('pointerup', pointer(1, 3, 4))
    expect(onPressEnd).toHaveBeenCalledTimes(1)
  })

  it('starts a press once however many pointers join it', () => {
    const onPressStart = vi.fn()
    const onPressEnd   = vi.fn()
    const { el }       = attach({ onPressStart, onPressEnd })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 10, 0))
    el.emit('pointerup', pointer(1, 0, 0))

    expect(onPressStart).toHaveBeenCalledTimes(1)
    // One finger is still down: the gesture is not over.
    expect(onPressEnd).not.toHaveBeenCalled()

    el.emit('pointerup', pointer(2, 10, 0))
    expect(onPressEnd).toHaveBeenCalledTimes(1)
  })

  it('does not invent a tap when a two-finger gesture ends', () => {
    const onTap  = vi.fn()
    const { el } = attach({ onTap })

    // A pinch that ends close to where it began, quickly. The tap check runs
    // when the last pointer leaves but measures against the press the first one
    // recorded, so without a multi-touch guard this reads as a tap nobody made.
    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 2, 0))
    el.emit('pointerup', pointer(1, 0, 0))
    el.emit('pointerup', pointer(2, 2, 0))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('taps again after a multi-touch gesture has ended', () => {
    const onTap  = vi.fn()
    const { el } = attach({ onTap })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointerdown', pointer(2, 2, 0))
    el.emit('pointerup', pointer(1, 0, 0))
    el.emit('pointerup', pointer(2, 2, 0))

    // The guard must clear, or the element never taps again.
    el.emit('pointerdown', pointer(3, 5, 5))
    el.emit('pointerup', pointer(3, 5, 5))

    expect(onTap).toHaveBeenCalledWith(5, 5, expect.anything())
  })

  it('ends the gesture when the browser takes the capture away', () => {
    const onPressEnd = vi.fn()
    const onDrag     = vi.fn()
    const { el }     = attach({ onPressEnd, onDrag })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('lostpointercapture', pointer(1, 0, 0))

    expect(onPressEnd).toHaveBeenCalledTimes(1)

    // A pointer that will never move again must not still be tracked.
    el.emit('pointermove', pointer(1, 40, 40))
    expect(onDrag).not.toHaveBeenCalled()
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

  it('fires onHover for moves with no pointer down', () => {
    const onHover = vi.fn()
    const onDrag  = vi.fn()
    const { el }  = attach({ onHover, onDrag })

    // no pointerdown first: hover must not depend on being tracked
    el.emit('pointermove', pointer(1, 12, 30))

    expect(onHover).toHaveBeenCalledWith(12, 30, expect.anything())
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('fires onHover alongside onDrag while dragging', () => {
    const onHover = vi.fn()
    const onDrag  = vi.fn()
    const { el }  = attach({ onHover, onDrag })

    el.emit('pointerdown', pointer(1, 0, 0))
    el.emit('pointermove', pointer(1, 5, 5))

    expect(onHover).toHaveBeenCalledWith(5, 5, expect.anything())
    expect(onDrag).toHaveBeenCalledWith(5, 5, expect.anything())
  })

  it('fires onLeave when the pointer exits', () => {
    const onLeave = vi.fn()
    const { el }  = attach({ onLeave })

    el.emit('pointerleave', pointer(1, 0, 0))
    expect(onLeave).toHaveBeenCalledTimes(1)
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
