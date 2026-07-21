import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import {
  Prop,
  markShared,
  ownsResource,
  createStandardMaterial,
  createToonMaterial,
  createGradientRamp,
  MATERIAL_PRESETS,
  createGridTexture,
  createNoiseTexture,
  createGradientTexture,
  crystalProp,
  rockProp,
  treeProp,
  lampPostProp,
} from 'ꭍ/assets'


describe('Prop', () => {
  it('exposes named parts and parents them', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const prop = new Prop('lamp').addPart('body', mesh)

    expect(prop.part('body')).toBe(mesh)
    expect(mesh.parent).toBe(prop)
    expect(prop.parts.size).toBe(1)
    prop.dispose()
  })

  it('refuses to silently replace a part', () => {
    const prop = new Prop()
    prop.addPart('body', new THREE.Object3D())
    expect(() => prop.addPart('body', new THREE.Object3D())).toThrow(/already exists/)
    prop.dispose()
  })

  it('builds from loose objects with Prop.from', () => {
    const prop = Prop.from(new THREE.Object3D(), new THREE.Object3D())
    expect(prop.parts.size).toBe(2)
    expect(prop.part('part0')).toBeDefined()
    expect(prop.part('part1')).toBeDefined()
    prop.dispose()
  })

  it('disposes owned geometry and materials exactly once', () => {
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial()
    const geoSpy   = vi.spyOn(geometry, 'dispose')
    const matSpy   = vi.spyOn(material, 'dispose')

    // one geometry + material backing TWO meshes — must still dispose once each
    const prop = new Prop()
      .addPart('a', new THREE.Mesh(geometry, material))
      .addPart('b', new THREE.Mesh(geometry, material))

    prop.dispose()
    expect(geoSpy).toHaveBeenCalledTimes(1)
    expect(matSpy).toHaveBeenCalledTimes(1)
  })

  it('never disposes resources tagged as shared', () => {
    const shared    = markShared(new THREE.MeshStandardMaterial())
    const owned     = new THREE.BoxGeometry()
    const sharedSpy = vi.spyOn(shared, 'dispose')
    const ownedSpy  = vi.spyOn(owned, 'dispose')

    const prop = new Prop().addPart('a', new THREE.Mesh(owned, shared))
    prop.dispose()

    expect(sharedSpy).not.toHaveBeenCalled()
    expect(ownedSpy).toHaveBeenCalledTimes(1)
    shared.dispose()
  })

  it('is idempotent — a second dispose is a no-op, not a double free', () => {
    const material = new THREE.MeshStandardMaterial()
    const spy      = vi.spyOn(material, 'dispose')

    const prop = new Prop().addPart('a', new THREE.Mesh(new THREE.BoxGeometry(), material))
    prop.dispose()
    prop.dispose()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('disposes adopted resources and detaches from its parent', () => {
    const adopted = { dispose: vi.fn() }
    const scene   = new THREE.Scene()
    const prop    = new Prop().adopt(adopted)
    scene.add(prop)

    prop.dispose()
    expect(adopted.dispose).toHaveBeenCalledTimes(1)
    expect(prop.parent).toBeNull()
    expect(scene.children).toHaveLength(0)
  })

  it('ownsResource treats untagged resources as owned', () => {
    const plain = new THREE.MeshStandardMaterial()
    expect(ownsResource(plain)).toBe(true)
    expect(ownsResource(markShared(plain))).toBe(false)
    plain.dispose()
  })
})

describe('materials', () => {
  it('applies a preset', () => {
    const gold = createStandardMaterial('gold')
    expect(gold.metalness).toBe(1)
    expect(gold).toBeInstanceOf(THREE.MeshStandardMaterial)
    gold.dispose()
  })

  it('lets overrides win over the preset', () => {
    const mat = createStandardMaterial('plastic', { roughness: 0.01 })
    expect(mat.roughness).toBe(0.01)
    expect(mat.metalness).toBe(0)
    mat.dispose()
  })

  it('returns a physical material with transmission for glass', () => {
    const glass = createStandardMaterial('glass')
    expect(glass).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect((glass as THREE.MeshPhysicalMaterial).transmission).toBe(1)
    glass.dispose()
  })

  it('accepts raw params with no preset', () => {
    const mat = createStandardMaterial({ metalness: 0.5, roughness: 0.2 })
    expect(mat.metalness).toBe(0.5)
    mat.dispose()
  })

  it('exposes every documented preset, and each one builds', () => {
    const names = Object.keys(MATERIAL_PRESETS)
    expect(names).toEqual(
      expect.arrayContaining([ 'metal', 'chrome', 'gold', 'plastic', 'rubber', 'matte', 'emissive', 'glass' ]),
    )

    for (const name of names) {
      const mat = createStandardMaterial(name as keyof typeof MATERIAL_PRESETS)
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial)
      mat.dispose()
    }
  })

  it('builds a toon material backed by a banded ramp', () => {
    const toon = createToonMaterial({ color: '#ff7ad9', steps: 3 })
    expect(toon).toBeInstanceOf(THREE.MeshToonMaterial)
    // NearestFilter is what keeps the bands hard — linear would smear them back
    // into a gradient and defeat the cel look
    expect(toon.gradientMap?.magFilter).toBe(THREE.NearestFilter)
    expect((toon.gradientMap as THREE.DataTexture | null)?.image.width).toBe(3)
    toon.dispose()
  })

  it('quantises the toon ramp into the requested number of bands', () => {
    const ramp = createGradientRamp(4)
    expect(Array.from(ramp.image.data!)).toEqual([ 0, 85, 170, 255 ])
    expect(ramp.generateMipmaps).toBe(false)
    ramp.dispose()

    // a ramp needs at least two stops to interpolate between
    const degenerate = createGradientRamp(1)
    expect(degenerate.image.width).toBe(2)
    degenerate.dispose()
  })
})

describe('textures', () => {
  it('builds a grid texture at the requested size', () => {
    const texture = createGridTexture({ size: 64 })
    expect(texture.image.width).toBe(64)
    expect(texture.image.data).toHaveLength(64 * 64 * 4)
    texture.dispose()
  })

  it('is deterministic for a given seed', () => {
    const a = createNoiseTexture({ size: 16, seed: 42 })
    const b = createNoiseTexture({ size: 16, seed: 42 })
    const c = createNoiseTexture({ size: 16, seed: 43 })

    const bytes = (texture: THREE.DataTexture) => Array.from(texture.image.data!)

    expect(bytes(a)).toEqual(bytes(b))
    expect(bytes(a)).not.toEqual(bytes(c))

    for (const texture of [ a, b, c ])
      texture.dispose()
  })

  it('interpolates a gradient from the first stop to the last', () => {
    const texture = createGradientTexture({ size: 8, from: '#000000', to: '#ffffff' })
    const data    = texture.image.data!
    const row     = (y: number) => data[y * 8 * 4]!

    expect(row(0)).toBe(0) // v = 0 -> `from`
    expect(row(7)).toBe(255) // v = 1 -> `to`
    expect(row(4)).toBeGreaterThan(row(2))
    texture.dispose()
  })
})

describe('prop catalogue', () => {
  it('builds every starter prop with its documented parts', () => {
    const crystal = crystalProp()
    const rock    = rockProp()
    const tree    = treeProp()
    const lamp    = lampPostProp({ withLight: true })

    expect(crystal.part('shell')).toBeDefined()
    expect(crystal.part('core')).toBeDefined()
    expect(rock.part('body')).toBeDefined()
    expect(tree.part('trunk')).toBeDefined()
    expect(tree.part('canopyUpper')).toBeDefined()
    expect(lamp.part('light')).toBeDefined()

    for (const prop of [ crystal, rock, tree, lamp ])
      prop.dispose()
  })

  it('omits the point light unless asked', () => {
    const lamp = lampPostProp()
    expect(lamp.part('light')).toBeUndefined()
    lamp.dispose()
  })
})
