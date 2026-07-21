// modules/orbit.ts
// Pointer-driven orbit controls as an app module: drag to rotate, pinch or
// wheel to zoom. View-only camera manipulation, deliberately outside app
// state (like scrolling a page). Uses only the public lib surface.

import { attachPointerGesture } from '../lib/index.js'

import type { AppModule, Vec3 } from '../lib/index.js'


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
  let detach: (() => void) | null = null

  return {
    name: 'orbit',

    build (ctx) {
      const { camera }               = ctx
      const [ minRadius, maxRadius ] = radiusClamp
      const [ tx, ty, tz ]           = target

      const dx = camera.position.x - tx
      const dy = camera.position.y - ty
      const dz = camera.position.z - tz

      let theta  = Math.atan2(dx, dz)
      let phi    = Math.atan2(dy, Math.hypot(dx, dz))
      let radius = Math.hypot(dx, dy, dz) || minRadius

      const updateCamera = (): void => {
        const r = radius * Math.cos(phi)
        camera.position.set(
          tx + Math.sin(theta) * r,
          ty + Math.sin(phi) * radius,
          tz + Math.cos(theta) * r,
        )
        camera.lookAt(tx, ty, tz)
      }

      detach = attachPointerGesture(ctx.renderer.domElement, {
        onDrag (dragX, dragY) {
          theta -= dragX * rotateSpeed
          phi    = Math.max(-maxPhi, Math.min(maxPhi, phi + dragY * rotateSpeed))
          updateCamera()
        },
        onPinch (deltaScale) {
          radius = Math.max(minRadius, Math.min(maxRadius, radius / deltaScale))
          updateCamera()
        },
        onWheel (delta) {
          radius = Math.max(minRadius, Math.min(maxRadius, radius * (1 + delta * zoomSpeed)))
          updateCamera()
        },
      })
    },

    dispose () {
      detach?.()
      detach = null
    },
  }
}

// perf: cheap. no per-frame work — the camera moves only on input events.
