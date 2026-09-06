// lib/app/capabilities.ts
// The well-known capability tokens — the contracts built-in modules publish to
// each other.
//
// Each one is a *structural* interface, not a reference to the module that
// happens to implement it today: a token named `camera-rig` says what a camera
// rig can be asked to do, so an isometric rig, a follow rig and something a
// consumer wrote all satisfy the same token and are interchangeable in a
// `use: []` array. A token whose value needs types from an optional peer
// dependency (physics) is declared by that module instead, so nothing here
// drags cannon-es into the core.

import { capability } from './capability.js'

import type * as THREE from 'three'
import type { Size, Vec3 } from '../types.js'


/** What any camera rig can be asked to do, whatever projection it uses. */
export interface CameraRigApi {

  /** The camera the rig drives — the same object as `ctx.camera`. */
  readonly camera: THREE.Camera

  /** Point the rig at a world position. */
  aim (target: Vec3): void

  /** Re-derive the projection for a new viewport. */
  resize (size: Size): void

  /** Zoom, in whatever unit the rig uses; ignored by rigs that cannot zoom. */
  zoom? (factor: number): void
}

/** The camera rig other modules aim, follow, or zoom. */
export const CameraRig = capability<CameraRigApi>('camera-rig')

/** Normalised pointer state, sampled once per tick rather than per event. */
export interface PointerState {

  /** Normalised device coordinates, -1..1 on both axes. */
  readonly ndc: readonly [number, number]

  /** Accumulated drag since the last tick, in CSS pixels. */
  readonly drag: readonly [number, number]

  /** Wheel delta accumulated since the last tick. */
  readonly wheel: number

  /** Pinch scale accumulated since the last tick; 1 is no change. */
  readonly pinch: number

  /** Whether a pointer is currently down. */
  readonly down: boolean
}

/** What an input module publishes for anything that reacts to pointers. */
export interface PointerInputApi {

  /** The state as of the current tick. Read it in `update`, never in an event. */
  readonly pointer: PointerState

  /** Raycast the pointer against a subtree, using the app camera. */
  pick (root: THREE.Object3D, recursive?: boolean): THREE.Intersection[]
}

/** Pointer state, sampled into the tick so input stays part of the flow. */
export const PointerInput = capability<PointerInputApi>('pointer-input')

/** A quality tier — one rung of the ladder a governor walks. */
export interface QualityTier {
  name: string

  /** 0 is the cheapest rung. Higher costs more. */
  level: number

  /** Free-form budget the consumer interprets: shadow size, particle count, … */
  budget: Readonly<Record<string, number | boolean>>
}

/** What a quality governor publishes so modules can size themselves to the device. */
export interface QualityApi {

  /** The tier in force right now. */
  readonly tier: QualityTier

  /** Every rung, cheapest first. */
  readonly tiers: readonly QualityTier[]

  /** Ask to drop a rung — a module that just measured itself over budget. */
  requestDowngrade (reason: string): void

  /** Run `listener` whenever the tier changes; returns an unsubscribe function. */
  onChange (listener: (tier: QualityTier) => void): () => void
}

/** The device-quality budget every heavy module should size itself against. */
export const Quality = capability<QualityApi>('quality')

/** What an asset catalogue publishes: named, deterministic, reusable content. */
export interface AssetCatalogApi {

  /** Every registered asset id. */
  readonly ids: readonly string[]

  /** Build (or return the cached) object for an id. */
  get (id: string): THREE.Object3D

  /** Whether an id is registered. */
  has (id: string): boolean
}

/** Named procedural content, built once and shared. */
export const AssetCatalog = capability<AssetCatalogApi>('asset-catalog')

/** What a post-processing chain publishes so other modules can extend it. */
export interface PostChainApi {

  /** Insert a pass before the output pass. */
  addPass (pass: { setSize? (width: number, height: number): void }): void

  /** The chain's current pixel size. */
  readonly size: Size
}

/** The module that owns the draw, for anything that wants a pass in the chain. */
export const PostChain = capability<PostChainApi>('post-chain')

/** What a persistence module publishes: durable state across mounts. */
export interface PersistenceApi {

  /** Write the current state to the backing store now, outside the tick. */
  flush (): void

  /** Drop the persisted copy. */
  clear (): void
}

/** State that outlives one mount. */
export const Persistence = capability<PersistenceApi>('persistence')
