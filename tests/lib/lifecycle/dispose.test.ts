import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { disposeMaterial, disposeScene } from 'Δ/lifecycle/dispose'


function makeTexture (): THREE.DataTexture {
  return new THREE.DataTexture(new Uint8Array([ 0, 0, 0, 255 ]), 1, 1)
}

describe('disposeMaterial', () => {
  it('disposes texture-shaped properties and the material itself', () => {
    const map    = makeTexture()
    const mat    = new THREE.MeshStandardMaterial({ map })
    const mapSpy = vi.spyOn(map, 'dispose')
    const matSpy = vi.spyOn(mat, 'dispose')

    disposeMaterial(mat)
    expect(mapSpy).toHaveBeenCalled()
    expect(matSpy).toHaveBeenCalled()
  })

  it('disposes texture-valued shader uniforms', () => {
    const uTex = makeTexture()
    const mat  = new THREE.ShaderMaterial({ uniforms: { uTex: { value: uTex }, uTime: { value: 0 }}})
    const spy  = vi.spyOn(uTex, 'dispose')

    disposeMaterial(mat)
    expect(spy).toHaveBeenCalled()
  })
})

describe('disposeScene', () => {
  it('recursively disposes geometries and materials', () => {
    const scene = new THREE.Scene()
    const geo   = new THREE.BoxGeometry()
    const mat   = new THREE.MeshBasicMaterial()
    const child = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial())
    const mesh  = new THREE.Mesh(geo, mat)
    mesh.add(child)
    scene.add(mesh)

    const spies = [
      vi.spyOn(geo, 'dispose'),
      vi.spyOn(mat, 'dispose'),
      vi.spyOn(child.geometry, 'dispose'),
      vi.spyOn(child.material, 'dispose'),
    ]

    disposeScene(scene)
    for (const spy of spies)
      expect(spy).toHaveBeenCalled()
  })

  it('handles material arrays', () => {
    const mats  = [ new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial() ]
    const mesh  = new THREE.Mesh(new THREE.BoxGeometry(), mats)
    const spies = mats.map(m => vi.spyOn(m, 'dispose'))

    disposeScene(mesh)
    for (const spy of spies)
      expect(spy).toHaveBeenCalled()
  })
})
