// modules/persistence/index.ts
// State that outlives one mount, as a module.
//
// The interesting part is not the writing — it is that a restore is a *write to
// app state*, and app state is written in exactly one place. So this module
// reads storage once during build, before any other module's build has run, and
// commits the restored slice through the same queue everything else uses. No
// module ever sees a world that was half-restored, and a replay from a saved
// state is the same code path as a replay from a fresh one.
//
// Writes go the other way on a timer rather than per tick: storage is
// synchronous and touching it 60 times a second is how a scene acquires a
// stutter nobody can find.

import { Persistence, defineScopedModule, openStorage, registerModule } from '../../lib/index.js'

import type { AppModule, FrameContext, ModuleContext, PersistenceApi } from '../../lib/index.js'


/** Options for {@link persistence}. */
export interface PersistenceOptions<T extends object = Record<string, unknown>> {

  /** Storage key. Give each independent slice its own. */
  key: string

  /** The state key this module owns, reads, restores and writes back. */
  at: string

  /** Seeded into `state[at]` when there is nothing stored. */
  initial: T

  /**
   * Which fields to persist. Omit to persist the whole slice. Naming them is
   * the difference between a save file and a snapshot of every transient the
   * scene happened to be holding.
   */
  fields?: readonly (keyof T & string)[]

  /**
   * Seconds between writes. The slice is only written when it changed.
   * @defaultValue 2
   */
  interval?: number

  /**
   * A token identifying this build. A stored slice from another build is
   * discarded rather than merged, because its shape is not this one's.
   */
  version?: string

  /** Injectable storage, for tests. @defaultValue {@link openStorage} */
  storage?: Storage | null
}

interface Envelope {
  version: string
  data:    Record<string, unknown>
}

function readEnvelope (storage: Storage | null, key: string, version: string): Record<string, unknown> | null {
  if (!storage)
    return null

  try {
    const raw = storage.getItem(key)

    if (!raw)
      return null

    const parsed = JSON.parse(raw) as Envelope

    return parsed?.version === version && parsed.data && typeof parsed.data === 'object'
      ? parsed.data
      : null
  }
  catch {
    // corrupt json, a quota error on read, storage revoked mid-session — all of
    // which mean "remember nothing", never "take the app down"
    return null
  }
}

/**
 * Persist one slice of app state across mounts, as an {@link AppModule}
 * publishing the {@link Persistence} capability.
 *
 * @param options - See {@link PersistenceOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @typeParam T - The persisted slice.
 * @example
 * createApp<State>(canvas, {
 *   loop: { fps: 0 },
 *   use:  [
 *     persistence<State, Settings>({
 *       key:     'scene:settings',
 *       at:      'settings',
 *       initial: { quality: 'high', muted: false },
 *       fields:  [ 'quality', 'muted' ],
 *       version: '1',
 *     }),
 *   ],
 * })
 */
export function persistence<
  S extends object = Record<string, unknown>,
  T extends object = Record<string, unknown>,
> (options: PersistenceOptions<T>): AppModule<S> {
  const interval = options.interval ?? 2
  const version  = options.version ?? '1'
  const storage  = options.storage === undefined ? openStorage(options.key) : options.storage

  let since   = 0
  let written = ''
  let latest  = options.initial

  /** Narrow the slice to the persisted fields, in a stable key order. */
  function pick (slice: T): Record<string, unknown> {
    const source                       = slice as Record<string, unknown>
    const keys                         = options.fields ?? Object.keys(source).sort()
    const out: Record<string, unknown> = {}

    for (const key of keys)
      out[key] = source[key]

    return out
  }

  function flush (slice: T): void {
    if (!storage)
      return

    const payload = JSON.stringify({ version, data: pick(slice) } satisfies Envelope)

    if (payload === written)
      return

    try {
      storage.setItem(options.key, payload)
      written = payload
    }
    catch {
      // a full quota is not a reason to stop rendering
    }
  }

  return defineScopedModule<Record<string, unknown>, string>(
    options.at,
    options.initial as unknown as Record<string, unknown>,
    {
      name:     'persistence',
      provides: [ Persistence ],

      // restore before anything reads the slice it restored
      order: -175,

      build (ctx: ModuleContext<Record<string, unknown>, unknown>) {
        const stored = readEnvelope(storage, options.key, version)

        // the restore is a commit like any other: queued here, drained at the
        // boundary, visible to every module from the first tick onward
        if (stored)
          ctx.commit(stored as never)

        ctx.provide(Persistence, {
          flush: () => flush(latest),
          clear () {
            written = ''
            try {
              storage?.removeItem(options.key)
            }
            catch {
              // nothing to do; the page simply cannot forget
            }
          },
        } satisfies PersistenceApi)
      },

      update (slice: unknown, frame: FrameContext) {
        // keep the last seen slice reachable, so an out-of-band flush() has
        // something current to write rather than the value from build time
        latest = slice as T
        since += frame.delta

        if (since < interval)
          return

        since = 0
        flush(latest)
      },

      dispose () {
        written = ''
        since   = 0
      },
    } as never,
  ) as unknown as AppModule<S>
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'persistence',
  title: 'Persisted state slice',
  summary:
    'Restores one state key from storage during build — as a queued commit, so no module sees a half-restored ' +
    'world — and writes it back on a timer when it changed. Storage is synchronous; touching it per tick is a stutter.',
  subpath:  'threejs-scene/modules/persistence',
  factory:  'persistence',
  tags:     [ 'state', 'storage' ],
  cost:     'free',
  provides: [ Persistence ],
  options:  [
    { name: 'key', type: 'string', summary: 'storage key; give each independent slice its own' },
    { name: 'at', type: 'string', summary: 'the state key this module owns, restores and writes back' },
    { name: 'initial', type: 'T', summary: 'seeded into state[at] when there is nothing stored' },
    { name: 'fields', type: 'string[]', summary: 'which fields to persist; omit for the whole slice' },
    { name: 'interval', type: 'number', summary: 'seconds between writes', default: '2' },
    { name: 'version', type: 'string', summary: 'a stored slice from another build is discarded, not merged', default: "'1'" },
  ],
  create: (options?: PersistenceOptions) => persistence(options as PersistenceOptions),
})

// perf: free. one JSON.stringify every `interval` seconds, skipped when nothing changed.
