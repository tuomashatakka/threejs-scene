// lib/state/access.ts
// Who owns the state, before and after the app exists.
//
// `createApp` takes an initial state and hands it to a store, and from that
// moment the store is its single writer. But an app is not mounted for the whole
// life of a page: a url is parsed before it, a saved snapshot is applied before
// it, and a WebGL context loss takes it down and builds another one — with the
// values the reader had moved, not the values that shipped.
//
// So "where does a write go" has two answers over time, and every writer would
// otherwise have to know which half of the page's life it is in. This is the one
// place that knows.

import type { Store } from './store.js'
import { withPath } from './path.js'


/** What a dotted-path write can carry: the three types a control or url writes. */
export type StateValue = number | string | boolean

export interface StateAccess<S extends object> {

  /**
   * The state as of now — the store's, once there is one.
   *
   * Safe to call every frame, and never safe to *hold*: the value is a different
   * object after every write.
   */
  read (): S

  /** Move one leaf, through whoever currently owns the state. */
  write (path: string, value: StateValue): void

  /**
   * A store now owns the state.
   *
   * @returns A function that takes ownership back — call it on teardown, so the
   * gap between one mount and the next still has somewhere to keep a write.
   */
  adopt (store: Store<S>): () => void
}

/**
 * Hold state that a store will later take over.
 *
 * @param authored - The starting state. Kept as-is and never mutated; writes
 * before {@link StateAccess.adopt} produce new objects via {@link withPath}.
 * @returns A {@link StateAccess}.
 *
 * @example
 * const access = createStateAccess(CONFIG)
 * access.write('look.bloom', 0.9)          // pre-mount: a plain object
 *
 * const app     = createApp(canvas, { state: access.read(), use: [ … ] })
 * const release = access.adopt(app.store)  // the store owns it from here
 *
 * access.write('look.bloom', 0.4)          // now a store commit
 * release()                                // teardown keeps the last value
 */
export function createStateAccess<S extends object> (authored: S): StateAccess<S> {
  let owner: Store<S> | null = null
  let loose                  = authored

  return {
    read: () => owner?.get() ?? loose,

    write (path, value) {
      if (!owner) {
        loose = withPath(loose, path, value)
        return
      }

      const next = withPath(owner.get(), path, value)

      // `withPath` hands back the same object when the leaf already held this
      // value, and `set` would spread it into a new one regardless — which would
      // wake every subscriber to report that nothing happened.
      if (next !== owner.get())
        owner.set(next)
    },

    adopt (store) {
      owner = store

      return () => {
        // Whatever moved while the app was up is what the next mount has to
        // start from, so the last committed state comes back out with the
        // ownership.
        loose = store.get()
        owner = null
      }
    },
  }
}
