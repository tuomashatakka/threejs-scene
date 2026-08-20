// lib/state/path.ts
// Dotted-path access into a plain config object. The point is that one string
// — 'look.bloom' — addresses the same leaf from a slider, a url parameter, a
// persisted settings snapshot and a headless capture flag, so a knob added to
// a config becomes reachable from all four the day it lands.
//
// Every read is total and every write is silent: a dead path yields `undefined`
// and writes nothing, rather than throwing. That is deliberate — these paths
// arrive from urls and stored snapshots, which go stale, and a stale key in a
// saved preference set must not take the app down on boot.


function walk (root: object, path: string): [ Record<string, unknown>, string ] | null {
  const keys = path.split('.')
  const last = keys.pop()
  let node: unknown = root

  for (const key of keys) {
    if (typeof node !== 'object' || node === null)
      return null

    node = (node as Record<string, unknown>)[key]
  }

  if (!last || typeof node !== 'object' || node === null)
    return null

  return [ node as Record<string, unknown>, last ]
}

/** Read a dotted path out of an object. `undefined` if any step is missing. */
export function readPath (root: object, path: string): unknown {
  const slot = walk(root, path)

  return slot ? slot[0][slot[1]] : undefined
}

/** Write a dotted path into an object. Silently does nothing if the path is dead. */
export function writePath (root: object, path: string, value: unknown): void {
  const slot = walk(root, path)

  if (slot)
    slot[0][slot[1]] = value
}

/** Read a dotted path as a number, falling back to `fallback` when it is not one. */
export function readNumberPath (root: object, path: string, fallback = 0): number {
  const value = readPath(root, path)

  return typeof value === 'number' ? value : fallback
}

/** Read a dotted path as a string, falling back to `fallback` when it is not one. */
export function readTextPath (root: object, path: string, fallback = ''): string {
  const value = readPath(root, path)

  return typeof value === 'string' ? value : fallback
}

/**
 * `writePath`, without mutating what it writes into.
 *
 * {@link createStore} commits a *new* object on every write, so a consumer still
 * holding the object from before the write goes on reading the values from
 * before it. Replacing only the spine of the path is what keeps that cheap:
 * setting `look.bloom` on a state of twenty sections copies two objects and
 * keeps the other eighteen by reference, so the frame after a slider moves
 * allocates almost nothing.
 *
 * Semantics are {@link writePath}'s, deliberately, because the same dotted
 * strings arrive from a slider, a url, a stored snapshot and a headless flag:
 * every write is silent. A path whose parent does not resolve writes nothing
 * rather than inventing the shape it would need, because a stale key in a saved
 * preference set must not take the app down on boot.
 *
 * @param state - The object to write into. Not mutated.
 * @param path - Dotted path to the leaf, e.g. `'look.bloom'`.
 * @param value - What to put there.
 * @returns The next state, or `state` itself when the write changed nothing —
 * which is what lets a store skip notifying its listeners.
 */
export function withPath<S extends object> (state: S, path: string, value: unknown): S {
  const keys = path.split('.')

  if (keys.some(key => key === ''))
    return state

  return spine(state, keys, value) as S ?? state
}

/**
 * Copy `node` along `keys`, and nothing else.
 *
 * @returns The replacement, `node` itself when the write changed nothing, or
 * `undefined` when the path ran into something that is not an object — the dead
 * path {@link writePath} would silently skip.
 */
function spine (node: unknown, keys: readonly string[], value: unknown): unknown {
  const [ key, ...rest ] = keys

  if (key === undefined || typeof node !== 'object' || node === null)
    return undefined

  const record = node as Record<string, unknown>

  // Writing the value it already holds is not a change, and a store that
  // notifies on identity would otherwise wake every subscriber to report that
  // nothing happened.
  if (rest.length === 0)
    return record[key] === value ? node : { ...record, [key]: value }

  const next = spine(record[key], rest, value)

  if (next === undefined)
    return undefined

  return next === record[key] ? node : { ...record, [key]: next }
}
