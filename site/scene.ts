// site/scene.ts
// The shared demo scene as an app module — one scene for both `bun run dev` and
// the deployed site. A rotating sculpture (a knot + emissive shards, two of them
// tagged for the outline effect), a reflective ground, and a bright sun mesh the
// god-rays / lens-flare effects track. Objects the post-processing effects need
// are findable by name / userData so effects.ts stays decoupled from this file.
//
// Dogfoods the module contract: state -> update -> scene (speed drives rotation),
// deterministic satellite palette via ctx.rng.

import * as THREE from 'three'

import { defineModule } from '@tuomashatakka/threejs-scene'

import type { AppModule } from '@tuomashatakka/threejs-scene'


export interface SceneState {
  speed: number
}

export const SUN_NAME = 'sun'

/** Marked meshes (for the outline effect) carry `userData.outline = true`. */
export function outlineTargets (scene: THREE.Scene): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse(obj => {
    if (obj.userData.outline)
      found.push(obj)
  })
  return found
}

/** The bright sun mesh god-rays / lens-flare track, by name. */
export function sunMesh (scene: THREE.Scene): THREE.Object3D | undefined {
  return scene.getObjectByName(SUN_NAME)
}

const PALETTE = [ 0x6ea8ff, 0xff7ab8, 0x8affc1, 0xffd27a ]

export function demoScene<S extends SceneState = SceneState> (): AppModule<S> {
  return defineModule<S>({
    name: 'demo-scene',

    build (ctx) {
      const group = new THREE.Group()
      group.name  = 'sculpture'

      const knot = new THREE.Mesh(
        new THREE.TorusKnotGeometry(1.6, 0.5, 220, 32),
        new THREE.MeshStandardMaterial({ color: 0x9fb2ff, metalness: 0.6, roughness: 0.25, emissive: 0x1b2a6b, emissiveIntensity: 1.2 }),
      )
      knot.castShadow       = true
      knot.userData.outline = true // a marked mesh for the outline effect
      group.add(knot)

      const rng = ctx.rng.fork('shards')
      for (let i = 0; i < 6; i++) {
        const geo      = i % 2 ? new THREE.IcosahedronGeometry(0.55, 0) : new THREE.OctahedronGeometry(0.6, 0)
        const color    = PALETTE[i % PALETTE.length]!
        const emissive = i % 3 === 0
        const mesh     = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color,
          metalness:         0.3,
          roughness:         0.4,
          emissive:          emissive ? color : 0x000000,
          emissiveIntensity: emissive ? 2.2 : 0,
        }))
        const angle  = i / 6 * Math.PI * 2
        mesh.position.set(Math.cos(angle) * 3.2, Math.sin(angle * 1.3) * 1.4, Math.sin(angle) * 3.2)
        mesh.castShadow = true
        if (i === 0)
          mesh.userData.outline = true
        group.add(mesh)
      }
      ctx.scene.add(group)

      // reflective ground — gives SSR / reflections something to bite on
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(24, 64),
        new THREE.MeshStandardMaterial({ color: 0x0e1018, metalness: 0.9, roughness: 0.35 }),
      )
      ground.name          = 'ground'
      ground.rotation.x    = -Math.PI / 2
      ground.position.y    = -2.4
      ground.receiveShadow = true
      ctx.scene.add(ground)

      // a bright sun sprite the god-rays / lens-flare effects track
      const sun = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
      )
      sun.name = SUN_NAME
      sun.position.set(6, 8, -4)
      ctx.scene.add(sun)
    },

    update (state, frame, ctx) {
      const group = ctx.scene.getObjectByName('sculpture')
      if (!group)
        return
      group.rotation.y = frame.elapsed * state.speed * 0.25
      group.children.forEach((m, i) => {
        m.rotation.x = frame.elapsed * state.speed * (0.3 + i * 0.05)
      })
    },
  })
}
