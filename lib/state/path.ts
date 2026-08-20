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
