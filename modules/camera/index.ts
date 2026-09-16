// modules/camera/index.ts
// The camera as a pluggable module rather than a constructor argument.
//
// `createApp({ camera })` still takes a prebuilt camera, and for a scene with
// one fixed viewpoint that is the right amount of machinery. This module is for
// the other case: the rig has to react to something — the viewport, a followed
// object, another module asking to look somewhere else — and that reaction is
// per-tick behaviour, which means it belongs in the flow rather than beside it.
//
// Because it publishes the generic `CameraRig` token, an isometric rig, a chase
// rig and something a consumer wrote are interchangeable: a module that wants
// to aim the view declares `requires: [ CameraRig ]` and never learns which
// projection it got.

import * as THREE from 'three'

import {
  CameraRig,
  aimIsoCamera,
  createFollowCamera,
  createIsoCamera,
  registerModule,
  resizeIsoCamera,
} from '../../lib/index.js'

import type {
  AppModule,
  CameraRigApi,
  FollowCameraOptions,
  FollowCameraStation,
  IsoCameraOptions,
  ModuleContext,
  Size,
  Vec3,
} from '../../lib/index.js'


/** Which projection the rig drives. */
export enum CameraRigKind {

  /** Orthographic dimetric/true-iso rig; see {@link createIsoCamera}. */
  Iso = 'iso',

  /** Damped perspective chase rig; see {@link createFollowCamera}. */
  Follow = 'follow',

  /** A plain perspective camera the rig only aims and re-frustums. */
  Perspective = 'perspective',
}

/** Where a follow rig reads its target from, per tick. */
export interface FollowTarget {

  /**
   * Resolve the object to follow. Called every tick, so it can return an object
   * that does not exist yet at build time — a body the physics module spawned,
   * a prop another module added to its own root.
   */
  resolve (ctx: ModuleContext): THREE.Object3D | null
}

/** Options for {@link cameraRig}. */
export interface CameraRigOptions {

  /** @defaultValue {@link CameraRigKind.Perspective} */
  kind?: CameraRigKind | `${CameraRigKind}`

  /** The point the rig looks at (iso, perspective). @defaultValue [0, 0, 0] */
  target?: Vec3

  /** Iso rig tuning; ignored by the other kinds. */
  iso?: IsoCameraOptions

  /** Follow rig tuning; ignored by the other kinds. */
  follow?: FollowCameraOptions

  /**
   * What a follow rig chases. Without one the rig holds its spawn pose, which
   * is the honest behaviour for a scene whose hero object has not spawned yet.
   */
  followTarget?: FollowTarget | ((ctx: ModuleContext) => THREE.Object3D | null)

  /** Perspective field of view in degrees. @defaultValue 50 */
  fov?: number

  /** @defaultValue 0.1 */
  near?: number

  /** @defaultValue 200 */
  far?: number

  /** Starting position for the perspective kind. @defaultValue [4, 3, 6] */
  position?: Vec3
}

/** What the follow kind adds on top of the generic rig contract. */
export interface CameraRigFollowApi {

  /** Re-aim the chase rig; see {@link FollowCamera.aim}. */
  station (station: FollowCameraStation): void

  /** Jump to the ideal pose immediately — spawn, teleport, cut. */
  snap (): void
}

/** The rig this module publishes: the generic contract plus the follow extras. */
export interface CameraRigModuleApi extends CameraRigApi, Partial<CameraRigFollowApi> {

  /** Which projection is actually in force. */
  readonly kind: CameraRigKind
}

const _position   = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()

/**
 * A camera rig as an {@link AppModule}, publishing the {@link CameraRig}
 * capability.
 *
 * The rig replaces the app camera in place rather than swapping the object:
 * `ctx.camera` is what `createApp` built, and a module that captured it at build
 * time keeps working. So pass the matching camera to `createApp` when you need
 * a projection the default perspective camera cannot express — an iso rig is
 * orthographic, and no amount of per-tick work makes a perspective camera
 * orthographic.
 *
 * @param options - See {@link CameraRigOptions}.
 * @returns A module for `createApp({ use: [ … ] })` or `app.use()`.
 * @typeParam S - Serializable app state shape.
 * @example
 * const camera = createIsoCamera(canvas.clientWidth / canvas.clientHeight, { viewSize: 24 })
 * const app = createApp(canvas, {
 *   camera,
 *   loop: { fps: 0 },
 *   use:  [ cameraRig({ kind: 'iso', iso: { viewSize: 24 }}) ],
 * })
 * @example
 * // a chase rig that finds its target after physics has spawned it
 * cameraRig({
 *   kind:         'follow',
 *   follow:       { offset: [ 0, 2.4, -7 ], positionDamping: 0.14 },
 *   followTarget: ctx => ctx.scene.getObjectByName('hovership') ?? null,
 * })
 */
export function cameraRig<S extends object = Record<string, unknown>> (
  options: CameraRigOptions = {},
): AppModule<S> {
  const kind    = (options.kind ?? CameraRigKind.Perspective) as CameraRigKind
  const resolve = typeof options.followTarget === 'function'
    ? options.followTarget
    : options.followTarget?.resolve

  let target: Vec3                                         = options.target ?? [ 0, 0, 0 ]
  let follow: ReturnType<typeof createFollowCamera> | null = null
  let camera: THREE.Camera
  let snapped = false

  /** Aim whatever projection we have at `target`. */
  function aimAt (): void {
    if (kind === CameraRigKind.Iso && (camera as THREE.OrthographicCamera).isOrthographicCamera)
      aimIsoCamera(camera as THREE.OrthographicCamera, { target })
    else
      camera.lookAt(target[0], target[1], target[2])
  }

  function reframe ({ width, height }: Size): void {
    const aspect = width / height || 1

    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      resizeIsoCamera(camera as THREE.OrthographicCamera, aspect)
      return
    }

    const perspective = camera as THREE.PerspectiveCamera

    if (perspective.isPerspectiveCamera) {
      perspective.aspect = aspect
      perspective.updateProjectionMatrix()
    }
  }

  return {
    name:     'camera',
    provides: [ CameraRig ],

    // the view is settled before the modules that read it
    order: -75,

    build (ctx) {
      camera = ctx.camera

      // A rig can only drive the projection the app was given. Say so once,
      // here, rather than letting an iso scene silently render in perspective.
      if (kind === CameraRigKind.Iso && !(camera as THREE.OrthographicCamera).isOrthographicCamera)
        ctx.violation(
          'SC009',
          "the iso rig needs an orthographic camera; pass createIsoCamera(...) as createApp's `camera` option",
        )

      if (kind === CameraRigKind.Follow)
        follow = createFollowCamera(options.follow ?? {})

      aimAt()
      reframe(ctx.size)

      const api: CameraRigModuleApi = {
        kind,
        camera,
        aim (next) {
          target = next
          aimAt()
        },
        resize: reframe,
        zoom (factor) {
          const ortho = camera as THREE.OrthographicCamera

          if (ortho.isOrthographicCamera) {
            ortho.zoom = Math.max(0.01, ortho.zoom * factor)
            ortho.updateProjectionMatrix()
            return
          }

          camera.position.lerp(_position.set(...target), 1 - 1 / factor)
        },
        station (station) {
          follow?.aim(station)
        },
        snap () {
          snapped = false
        },
      }

      ctx.provide(CameraRig, api)
    },

    update (_view, frame, ctx) {
      if (!follow || !resolve)
        return

      const object = resolve(ctx)

      if (!object)
        return

      object.getWorldPosition(_position)
      object.getWorldQuaternion(_quaternion)

      if (!snapped) {
        follow.snap(_position, _quaternion)
        snapped = true
      }
      else
        follow.update(_position, _quaternion, frame.delta)

      // project the rig's pose onto the app camera — one direction, as ever
      camera.position.copy(follow.camera.position)
      camera.quaternion.copy(follow.camera.quaternion)
    },

    resize (size) {
      reframe(size)

      if (follow) {
        follow.camera.aspect = size.width / size.height || 1
        follow.camera.updateProjectionMatrix()
      }
    },
  }
}

/** Registry entry — see {@link listModules}. */
export const descriptor = registerModule({
  id:    'camera',
  title: 'Camera rig',
  summary:
    'The camera as a module: aims, re-frustums on resize, and optionally chases an object with damping. ' +
    'Publishes the generic camera-rig capability, so anything that wants to point the view can do so without ' +
    'knowing which projection it got.',
  subpath:  'threejs-scene/modules/camera',
  factory:  'cameraRig',
  tags:     [ 'camera', 'core' ],
  cost:     'free',
  provides: [ CameraRig ],
  options:  [
    { name: 'kind', type: "'iso' | 'follow' | 'perspective'", summary: 'which projection the rig drives; iso requires an orthographic camera on createApp', default: "'perspective'" },
    { name: 'target', type: 'Vec3', summary: 'the point the rig looks at', default: '[0, 0, 0]' },
    { name: 'iso', type: 'IsoCameraOptions', summary: 'view size, flavor, yaw for the iso kind' },
    { name: 'follow', type: 'FollowCameraOptions', summary: 'offset, look-ahead and damping half-lives for the follow kind' },
    { name: 'followTarget', type: '(ctx: ModuleContext) => Object3D | null', summary: 'resolved every tick, so the target may spawn after the rig mounts' },
  ],
  create: (options?: CameraRigOptions) => cameraRig(options),
})

// perf: free. one lookAt per tick at worst; the follow rig is two lerps.
