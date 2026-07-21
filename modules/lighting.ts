// modules/lighting.ts
// The standard three-part lighting rig as an app module: PMREM room
// environment for IBL, a warm shadow-casting sun, and a hemisphere fill.
// Lives outside the core on purpose — it uses only the public lib surface,
// proving the module contract is sufficient for built-ins.

import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import type { AppModule, SceneContext, Vec3 } from '../lib/index'


/** Environment (IBL) tuning for {@link standardLighting}. */
export interface LightingEnvOptions {

  /** @defaultValue 1 */
  intensity?: number
}

/** Sun tuning for {@link standardLighting}. */
export interface LightingSunOptions {

  /** @defaultValue '#fff5e0' */
  color?: THREE.ColorRepresentation

  /** @defaultValue 3 */
  intensity?: number

  /** @defaultValue [8, 12, 6] */
  position?: Vec3

  /** Shadow map resolution per side in texels. @defaultValue 2048 */
  shadowMapSize?: number

  /** Half-extent of the orthographic shadow frustum. @defaultValue 15 */
  shadowFrustum?: number

  /** @defaultValue 30 */
  shadowFar?: number
}

/** Hemisphere fill tuning for {@link standardLighting}. */
export interface LightingHemiOptions {

  /** @defaultValue '#a0c0ff' */
  skyColor?: THREE.ColorRepresentation

  /** @defaultValue '#3a2a1a' */
  groundColor?: THREE.ColorRepresentation

  /** @defaultValue 0.4 */
  intensity?: number
}

/** Options for {@link standardLighting}, grouped per rig part. */
export interface LightingOptions {

  /**
   * PMREM room-environment IBL. Pass `false` to skip (headless tests,
   * stylized flat looks).
   * @defaultValue true
   */
  env?: boolean | LightingEnvOptions

  sun?:  LightingSunOptions
  hemi?: LightingHemiOptions
}

function createSun ({
  color = '#fff5e0',
  intensity = 3,
  position = [ 8, 12, 6 ],
  shadowMapSize = 2048,
  shadowFrustum = 15,
  shadowFar = 30,
}: LightingSunOptions): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(color, intensity)
  sun.position.set(...position)
  sun.castShadow = true
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  sun.shadow.camera.near   = 1
  sun.shadow.camera.far    = shadowFar
  sun.shadow.camera.top    = shadowFrustum
  sun.shadow.camera.right  = shadowFrustum
  sun.shadow.camera.bottom = -shadowFrustum
  sun.shadow.camera.left   = -shadowFrustum
  sun.shadow.bias          = -0.0001
  sun.shadow.normalBias    = 0.02
  return sun
}

function applyEnvironment (ctx: SceneContext, { intensity = 1 }: LightingEnvOptions): THREE.Texture {
  const pmrem      = new THREE.PMREMGenerator(ctx.renderer)
  const envScene   = new RoomEnvironment()
  const envTexture = pmrem.fromScene(envScene, 0.04).texture

  ctx.scene.environment          = envTexture
  ctx.scene.environmentIntensity = intensity
  pmrem.dispose()
  envScene.traverse((obj: THREE.Object3D) => (obj as THREE.Mesh).geometry?.dispose())
  return envTexture
}

/**
 * Standard lighting rig as an {@link AppModule}: IBL environment + warm
 * shadow-casting sun + hemisphere fill.
 *
 * @param options - Per-part overrides; see {@link LightingOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @example
 * createApp(canvas, { use: [ standardLighting({ sun: { intensity: 2 } }) ] })
 */
export function standardLighting<S extends object = Record<string, unknown>> (options: LightingOptions = {}): AppModule<S> {
  let scene: THREE.Scene | null = null
  let env: THREE.Texture | null = null
  let sun: THREE.DirectionalLight
  let hemi: THREE.HemisphereLight

  return {
    name: 'lighting',

    build (ctx) {
      scene = ctx.scene
      if (options.env !== false)
        env = applyEnvironment(ctx, options.env === true ? {} : options.env ?? {})

      sun  = createSun(options.sun ?? {})
      hemi = new THREE.HemisphereLight(
        options.hemi?.skyColor ?? '#a0c0ff',
        options.hemi?.groundColor ?? '#3a2a1a',
        options.hemi?.intensity ?? 0.4,
      )
      scene.add(sun, sun.target, hemi)
    },

    dispose () {
      if (!scene)
        return
      if (env) {
        env.dispose()
        scene.environment = null
      }
      scene.remove(sun, sun.target, hemi)
      scene = null
      env   = null
    },
  }
}

// perf: medium. shadow render pass per sun per frame. Tune shadowMapSize down
// for mobile.
