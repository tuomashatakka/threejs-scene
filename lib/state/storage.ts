// lib/state/storage.ts
// Whether this page is allowed to remember anything.
//
// `localStorage` is not a property you can test for. Reading it throws outright
// in a sandboxed iframe, in Safari's private mode once the quota is spent, and
// under any embedding that disallows storage — and it throws on *access*, not on
// use, so a feature-detect has to be a real read inside a `try`. Every persisted
// store needs this exact probe, and a store that skips it takes the app down on
// boot in the environments least able to report why.

/**
 * The storage this page may actually use, or `null` when it has none.
 *
 * @param probe - A key to attempt a read on. Its value is discarded; only
 * whether the read *throws* is the question.
 * @returns `globalThis.localStorage`, or `null` when it is unusable — which
 * callers should treat as "remember nothing" rather than as an error.
 */
export function openStorage (probe: string): Storage | null {
  try {
    const store = globalThis.localStorage

    store.getItem(probe)

    return store
  }
  catch {
    return null
  }
}
