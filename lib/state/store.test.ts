import { describe, expect, it, vi } from 'vitest'

import { createStore } from './store.js'


interface CounterState {
  count: number
  label: string
}

type CounterAction = { type: 'increment' } | { type: 'noop' }

const initial: CounterState = { count: 0, label: 'a' }

describe('createStore', () => {
  it('returns the initial state', () => {
    const store = createStore(initial)
    expect(store.get()).toEqual({ count: 0, label: 'a' })
  })

  it('set shallow-merges a patch and notifies with next and prev', () => {
    const store    = createStore(initial)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set({ count: 2 })
    expect(store.get()).toEqual({ count: 2, label: 'a' })
    expect(listener).toHaveBeenCalledWith({ count: 2, label: 'a' }, { count: 0, label: 'a' })
  })

  it('dispatch runs the reducer', () => {
    const store = createStore<CounterState, CounterAction>(initial, (state, action) =>
      action.type === 'increment' ? { ...state, count: state.count + 1 } : state)

    store.dispatch({ type: 'increment' })
    expect(store.get().count).toBe(1)
  })

  it('dispatch throws when the store has no reducer', () => {
    const store = createStore<CounterState, CounterAction>(initial)
    expect(() => store.dispatch({ type: 'increment' })).toThrow(/no reducer/)
  })

  it('reducers returning the same reference do not notify', () => {
    const store    = createStore<CounterState, CounterAction>(initial, state => state)
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: 'noop' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribe stops notifications', () => {
    const store    = createStore(initial)
    const listener = vi.fn()
    const off      = store.subscribe(listener)

    off()
    store.set({ count: 9 })
    expect(listener).not.toHaveBeenCalled()
  })
})
