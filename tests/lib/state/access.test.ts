import { describe, expect, it, vi } from 'vitest'

import { createStateAccess, createStore } from 'Δ/index'


interface Look {
  look: { bloom: number, grade: string }
}

const authored: Look = { look: { bloom: 0.4, grade: 'noir' }}


describe('state ownership handoff', () => {
  it('writes into a plain object before a store exists', () => {
    const access = createStateAccess(authored)

    access.write('look.bloom', 0.9)

    expect(access.read().look.bloom).toBe(0.9)

    // The authored object is the one thing that must never move — it is what a
    // reset gives back.
    expect(authored.look.bloom).toBe(0.4)
  })

  it('routes writes through the store once adopted', () => {
    const access = createStateAccess(authored)
    const store  = createStore<Look>(access.read())

    access.adopt(store)
    access.write('look.bloom', 0.77)

    expect(store.get().look.bloom).toBe(0.77)
    expect(access.read().look.bloom).toBe(0.77)
  })

  it('does not wake the store for a write that changes nothing', () => {
    const access   = createStateAccess(authored)
    const store    = createStore<Look>(access.read())
    const listener = vi.fn()

    store.subscribe(listener)
    access.adopt(store)

    access.write('look.bloom', 0.5)
    access.write('look.bloom', 0.5)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the last committed state when ownership is released', () => {
    const access  = createStateAccess(authored)
    const store   = createStore<Look>(access.read())
    const release = access.adopt(store)

    access.write('look.bloom', 0.61)
    release()

    // No store now, but the next mount is built from `read()` — and it has to
    // open on what was last asked for, not on what shipped.
    expect(access.read().look.bloom).toBe(0.61)

    access.write('look.grade', 'dusk')

    expect(access.read().look.bloom).toBe(0.61)
    expect(access.read().look.grade).toBe('dusk')
  })

  it('can be adopted again by a second store', () => {
    const access = createStateAccess(authored)
    const first  = createStore<Look>(access.read())
    const undo   = access.adopt(first)

    access.write('look.bloom', 0.2)
    undo()

    const second = createStore<Look>(access.read())

    access.adopt(second)

    expect(second.get().look.bloom).toBe(0.2)

    access.write('look.bloom', 0.3)

    expect(second.get().look.bloom).toBe(0.3)
    expect(first.get().look.bloom).toBe(0.2)
  })
})
