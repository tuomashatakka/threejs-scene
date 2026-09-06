// lib/app/capability.ts
// Capability tokens — the typed handshake two modules use to find each other
// without importing each other.
//
// A module `provides` a token and publishes a value for it during build; a
// module that `requires` the token calls `ctx.resolve(token)` and gets that
// value back, fully typed. Two consequences that matter more than the
// convenience: the dependency is *declared*, so the runtime can order modules
// by it instead of by whatever order somebody happened to list them in, and it
// is *scoped*, so a module reaches its collaborators through one narrow door
// rather than through a shared global.

/** Phantom brand: carries `T` at the type level, absent at runtime. */
declare const CAPABILITY_TYPE: unique symbol

/**
 * A typed name for something one module offers to the others. Create with
 * {@link capability}; publish with `ctx.provide`; read with `ctx.resolve`.
 *
 * @typeParam T - The value a provider publishes under this token.
 */
export interface Capability<T> {

  /** Registry key. Two tokens with the same name are the same capability. */
  readonly name: string

  /** Phantom — never present at runtime. */
  readonly [CAPABILITY_TYPE]?: T
}

/** The value type carried by a {@link Capability}. */
export type CapabilityValue<C> = C extends Capability<infer T> ? T : never

/** Any capability token, when the carried type is irrelevant. */
export type AnyCapability = Capability<never>

/**
 * Mint a capability token.
 *
 * Name it after the contract, not the implementation — `'camera-rig'`, not
 * `'iso-camera'` — so a second implementation can take over the token without
 * every consumer changing.
 *
 * @param name - Registry key. Must be unique across the app.
 * @returns A {@link Capability} token carrying `T`.
 * @typeParam T - The value a provider publishes under this token.
 * @example
 * export const CameraRig = capability<{ aim (at: Vec3): void }>('camera-rig')
 */
export function capability<T> (name: string): Capability<T> {
  return { name }
}

/** Narrow an unknown value to a capability token. */
export function isCapability (value: unknown): value is Capability<unknown> {
  return typeof (value as Capability<unknown> | undefined)?.name === 'string'
}

/** A token, or the bare name of one — what `provides`/`requires` accept. */
export type CapabilityRef = AnyCapability | Capability<unknown> | string

/** The registry key for a token or a bare name. */
export function capabilityName (ref: CapabilityRef): string {
  return typeof ref === 'string' ? ref : ref.name
}
