import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from 'Δ/index'
import { LightingRig, standardLighting } from 'ꭍ/lighting'


function fakeRenderer (): THREE.WebGLRenderer {
  return {
    render:     vi.fn(),
    setSize:    vi.fn(),
    compile:    vi.fn(),
    dispose:    vi.fn(),
    domElement: {},
  } as unknown as THREE.WebGLRenderer
}

const canvas = () => ({}) as HTMLCanvasElement

/** Lights live under the module's own root, not loose on the scene. */
const lightsIn = (root: THREE.Object3D): THREE.Light[] =>
  root.children.filter((obj): obj is THREE.Light => (obj as THREE.Light).isLight)

describe('standardLighting', () => {
  it('adds sun (with target) and hemisphere fill under its own root', () => {
    const app    = createApp(canvas(), { renderer: fakeRenderer() })
    const handle = app.use(standardLighting({ env: false }))
    const lights = lightsIn(handle.root)

    expect(lights.some(obj => (obj as THREE.DirectionalLight).isDirectionalLight)).toBe(true)
    expect(lights.some(obj => (obj as THREE.HemisphereLight).isHemisphereLight)).toBe(true)

    // the root is scoped to the module, and the scene holds nothing but the root
    expect(handle.root.parent).toBe(app.ctx.scene)
    expect(lightsIn(app.ctx.scene)).toHaveLength(0)
    expect(app.violations).toEqual([])
    app.dispose()
  })

  it('applies sun and hemi overrides', () => {
    const app    = createApp(canvas(), { renderer: fakeRenderer() })
    const handle = app.use(standardLighting({
      env:  false,
      sun:  { intensity: 7, position: [ 1, 2, 3 ]},
      hemi: { intensity: 0.9 },
    }))

    const sun  = lightsIn(handle.root).find((obj): obj is THREE.DirectionalLight => (obj as THREE.DirectionalLight).isDirectionalLight)
    const hemi = lightsIn(handle.root).find((obj): obj is THREE.HemisphereLight => (obj as THREE.HemisphereLight).isHemisphereLight)

    expect(sun?.intensity).toBe(7)
    expect(sun?.position.toArray()).toEqual([ 1, 2, 3 ])
    expect(sun?.castShadow).toBe(true)
    expect(hemi?.intensity).toBe(0.9)
    app.dispose()
  })

  it('publishes the rig as a capability other modules can retune', () => {
    const app = createApp(canvas(), {
      renderer: fakeRenderer(),
      use:      [ standardLighting({ env: false }) ],
    })

    const rig = app.resolve(LightingRig)
    expect(rig.environment).toBeNull()

    rig.setSun({ intensity: 0.5, position: [ 4, 4, 4 ]})
    expect(rig.sun.intensity).toBe(0.5)
    expect(rig.sun.position.toArray()).toEqual([ 4, 4, 4 ])
    app.dispose()
  })

  it('removes its lights and its root on dispose', () => {
    const app    = createApp(canvas(), { renderer: fakeRenderer() })
    const handle = app.use(standardLighting({ env: false }))

    expect(lightsIn(handle.root).length).toBeGreaterThan(0)

    handle.remove()
    expect(handle.mounted).toBe(false)
    expect(handle.root.parent).toBeNull()
    expect(handle.root.children).toHaveLength(0)
    expect(() => app.resolve(LightingRig)).toThrow(/no module provides/)
    app.dispose()
  })
})
