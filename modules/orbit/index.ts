// modules/orbit.ts
// Pointer-driven orbit controls as an app module: drag to rotate, pinch or
// wheel to zoom. View-only camera manipulation, deliberately outside app
// state (like scrolling a page). Uses only the public lib surface.

import { CameraRig, attachPointerGesture, capability, registerModule } from '../../lib/index.js'

import type { AppModule, CameraRigApi, Size, Vec3 } from '../../lib/index.js'


/** What the orbit module publishes on top of the generic camera-rig contract. */
export interface OrbitApi extends CameraRigApi {

  /** Current spherical position as `[theta, phi, radius]`, in radians/metres. */
  readonly spherical: readonly [number, number, number]

  /** Set the spherical position directly — replays, saved viewpoints, tours. */
  setSpherical (theta: number, phi: number, radius: number): void
}

/** The orbit rig itself, for anything that wants to drive or read the view. */
export const Orbit = capability<OrbitApi>('orbit')


/** Options for {@link orbitControls}. */
export interface OrbitOptions {

  /** Radians of rotation per dragged CSS pixel. @defaultValue 0.005 */
  rotateSpeed?: number

  /** Zoom factor per wheel deltaY unit. @defaultValue 0.001 */
  zoomSpeed?: number

  /** Orbit radius clamp as `[min, max]`. @defaultValue [2, 50] */
  radius?: readonly [number, number]

  /** Vertical angle clamp in radians (± from horizontal). @defaultValue 1.4 */
  maxPhi?: number

  /** Point the camera orbits and looks at. @defaultValue [0, 0, 0] */
  target?: Vec3
}

/**
 * Orbit controls as an {@link AppModule}: attaches unified pointer gestures
 * (mouse, touch, pen) to the renderer's canvas and drives the app camera
 * around `target`. The initial spherical position derives from wherever the
 * camera already is.
 *
 * @param options - Speeds and clamps; see {@link OrbitOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @example
 * createApp(canvas, { use: [ orbitControls({ radius: [ 2, 50 ] }) ] })
 */
export function orbitControls<S extends object = Record<string, unknown>> ({
  rotateSpeed = 0.005,
  zoomSpeed = 0.001,
  radius: radiusClamp = [ 2, 50 ],
  maxPhi = 1.4,
  target = [ 0, 0, 0 ],
}: OrbitOptions = {}): AppModule<S> {
  const [ minRadius, maxRadius ] = radiusClamp
  let [ tx, ty, tz ]             = target

  let theta  = 0
  let phi    = 0
  let radius = minRadius

  return {
    name:     'orbit',
    provides: [ CameraRig, Orbit ],

    // input-shaped: run before the modules that read the camera
    order: -100,

    build (ctx) {
      const { camera } = ctx

      const dx = camera.position.x - tx
      const dy = camera.position.y - ty
      const dz = camera.position.z - tz

      theta  = Math.atan2(dx, dz)
      phi    = Math.atan2(dy, Math.hypot(dx, dz))
      radius = Math.hypot(dx, dy, dz) || minRadius

      const apply = (): void => {
        const flat = radius * Math.cos(phi)

        camera.position.set(
          tx + Math.sin(theta) * flat,
          ty + Math.sin(phi) * radius,
          tz + Math.cos(theta) * flat,
        )
        camera.lookAt(tx, ty, tz)
      }

      // the detach function is a resource like any other, so ctx.own runs it
      ctx.own(attachPointerGesture(ctx.renderer.domElement, {
        onDrag (dragX, dragY) {
          theta -= dragX * rotateSpeed
          phi    = Math.max(-maxPhi, Math.min(maxPhi, phi + dragY * rotateSpeed))
          apply()
        },
        onPinch (deltaScale) {
          radius = Math.max(minRadius, Math.min(maxRadius, radius / deltaScale))
          apply()
        },
        onWheel (delta) {
          radius = Math.max(minRadius, Math.min(maxRadius, radius * (1 + delta * zoomSpeed)))
          apply()
        },
      }))

      apply()

      const api: OrbitApi = {
        camera,
        get spherical () {
          return [ theta, phi, radius ] as const
        },
        setSpherical (nextTheta, nextPhi, nextRadius) {
          theta  = nextTheta
          phi    = Math.max(-maxPhi, Math.min(maxPhi, nextPhi))
          radius = Math.max(minRadius, Math.min(maxRadius, nextRadius))
          apply()
        },
        aim ([ x, y, z ]) {
          tx = x
          ty = y
          tz = z
          apply()
        },
        zoom (factor) {
          radius = Math.max(minRadius, Math.min(maxRadius, radius / factor))
          apply()
        },
        resize (_size: Size) {
          apply()
        },
      }

      ctx.provide(CameraRig, api)
      ctx.provide(Orbit, api)
    },
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'orbit',
  title: 'Orbit controls',
  summary:
    'Drag to rotate, pinch or wheel to zoom, around a fixed target. View-only camera ' +
    'manipulation, deliberately outside app state — like scrolling a page.',
  subpath:  'threejs-scene/modules/orbit',
  factory:  'orbitControls',
  tags:     [ 'input', 'camera' ],
  cost:     'free',
  provides: [ CameraRig, Orbit ],
  options:  [
    { name: 'rotateSpeed', type: 'number', summary: 'radians of rotation per dragged CSS pixel', default: '0.005' },
    { name: 'zoomSpeed', type: 'number', summary: 'zoom factor per wheel deltaY unit', default: '0.001' },
    { name: 'radius', type: '[number, number]', summary: 'orbit radius clamp', default: '[2, 50]' },
    { name: 'maxPhi', type: 'number', summary: 'vertical angle clamp in radians, ± from horizontal', default: '1.4' },
    { name: 'target', type: 'Vec3', summary: 'the point the camera orbits and looks at', default: '[0, 0, 0]' },
  ],
  create: (options?: OrbitOptions) => orbitControls(options),
})

// perf: cheap. no per-frame work — the camera moves only on input events.
