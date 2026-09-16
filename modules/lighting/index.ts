// modules/lighting/index.ts
// The standard three-part lighting rig as an app module: PMREM room
// environment for IBL, a warm shadow-casting sun, and a hemisphere fill.
// Lives outside the core on purpose — it uses only the public lib surface,
// proving the module contract is sufficient for built-ins.
//
// Scoped like every other module: the lights hang off ctx.root rather than off
// the scene, the environment texture goes through ctx.own, and the one piece of
// genuinely app-wide state it touches (scene.environment) is restored by an
// explicit cleanup rather than left for the next mount to discover.

import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import { capability, registerModule } from '../../lib/index.js'

import type { AppModule, ModuleContext, Vec3 } from '../../lib/index.js'


/** What the lighting rig publishes so other modules can read or retune it. */
export interface LightingRigApi {
  readonly sun:  THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight

  /** The IBL texture, or `null` when `env: false`. */
  readonly environment: THREE.Texture | null

  /** Retune the sun without rebuilding the rig. */
  setSun (options: Pick<LightingSunOptions, 'color' | 'intensity' | 'position'>): void
}

/** The scene's light rig, for modules that need to aim or dim it. */
export const LightingRig = capability<LightingRigApi>('lighting-rig')


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

function applyEnvironment (ctx: ModuleContext, { intensity = 1 }: LightingEnvOptions): THREE.Texture {
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
  return {
    name:     'lighting',
    provides: [ LightingRig ],

    // lights first: a module that reads the rig in `start` needs it to exist
    order: -50,

    build (ctx) {
      const env = options.env === false
        ? null
        : ctx.own(applyEnvironment(ctx, options.env === true ? {} : options.env ?? {}))

      // scene.environment is app-wide, so put it back the way it was found
      if (env)
        ctx.onCleanup(() => {
          ctx.scene.environment = null
        })

      const sun  = createSun(options.sun ?? {})
      const hemi = new THREE.HemisphereLight(
        options.hemi?.skyColor ?? '#a0c0ff',
        options.hemi?.groundColor ?? '#3a2a1a',
        options.hemi?.intensity ?? 0.4,
      )

      // ctx.own detaches and disposes these; ctx.root scopes them to this module
      ctx.root.add(ctx.own(sun), sun.target, ctx.own(hemi))

      ctx.provide(LightingRig, {
        sun,
        hemi,
        environment: env,
        setSun ({ color, intensity, position }) {
          if (color !== undefined)
            sun.color.set(color)
          if (intensity !== undefined)
            sun.intensity = intensity
          if (position !== undefined)
            sun.position.set(...position)
        },
      })
    },
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'lighting',
  title: 'Standard lighting',
  summary:
    'IBL environment + warm shadow-casting sun + hemisphere fill. The default rig for anything ' +
    'lit with physical materials; mount it before the content that needs the environment map.',
  subpath:  'threejs-scene/modules/lighting',
  factory:  'standardLighting',
  tags:     [ 'lighting', 'core' ],
  cost:     'medium',
  provides: [ LightingRig ],
  options:  [
    { name: 'env', type: 'boolean | { intensity?: number }', summary: 'PMREM room-environment IBL; false for a stylized flat look or a headless test', default: 'true' },
    { name: 'sun', type: 'LightingSunOptions', summary: 'colour, intensity, position, and the shadow frustum/map size', default: '{ intensity: 3, position: [8, 12, 6] }' },
    { name: 'hemi', type: 'LightingHemiOptions', summary: 'sky/ground fill colours and intensity', default: '{ intensity: 0.4 }' },
  ],
  create: (options?: LightingOptions) => standardLighting(options),
})

// perf: medium. shadow render pass per sun per frame. Tune shadowMapSize down
// for mobile.
