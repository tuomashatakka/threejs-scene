import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../lib/index.js'
import { standardLighting } from './lighting.js'


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

describe('standardLighting', () => {
  it('adds sun (with target) and hemisphere fill to the scene', () => {
    const app = createApp(canvas(), {
      renderer: fakeRenderer(),
      use:      [ standardLighting({ env: false }) ],
    })

    const lights = app.ctx.scene.children
    expect(lights.some(obj => (obj as THREE.DirectionalLight).isDirectionalLight)).toBe(true)
    expect(lights.some(obj => (obj as THREE.HemisphereLight).isHemisphereLight)).toBe(true)
    app.dispose()
  })

  it('applies sun and hemi overrides', () => {
    const app = createApp(canvas(), {
      renderer: fakeRenderer(),
      use:      [ standardLighting({
        env:  false,
        sun:  { intensity: 7, position: [ 1, 2, 3 ]},
        hemi: { intensity: 0.9 },
      }) ],
    })

    const sun  = app.ctx.scene.children.find((obj): obj is THREE.DirectionalLight => (obj as THREE.DirectionalLight).isDirectionalLight)
    const hemi = app.ctx.scene.children.find((obj): obj is THREE.HemisphereLight => (obj as THREE.HemisphereLight).isHemisphereLight)
    expect(sun?.intensity).toBe(7)
    expect(sun?.position.toArray()).toEqual([ 1, 2, 3 ])
    expect(sun?.castShadow).toBe(true)
    expect(hemi?.intensity).toBe(0.9)
    app.dispose()
  })

  it('removes its lights on dispose', () => {
    const app    = createApp(canvas(), { renderer: fakeRenderer() })
    const handle = app.use(standardLighting({ env: false }))
    const scene  = app.ctx.scene

    const countLights = () => scene.children.filter(obj => (obj as THREE.Light).isLight).length
    expect(countLights()).toBeGreaterThan(0)

    handle.remove()
    expect(countLights()).toBe(0)
    app.dispose()
  })
})
