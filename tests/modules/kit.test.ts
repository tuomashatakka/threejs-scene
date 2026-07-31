import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createSeededRng } from 'Δ/state/rng'

import {
  KIT_PALETTE,
  KIT_PROP_NAMES,
  applyGrime,
  bakeFacetColors,
  buildKitGeometry,
  createPlacementField,
  kitMaterial,
  kitProp,
  mergeParts,
  part,
  scatterInstances,
} from 'ꭍ/assets'

import type { KitPropName } from 'ꭍ/assets'


function extentOf (geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox as THREE.Box3
}


describe('bakeFacetColors', () => {
  it('gives every triangle one flat shade', () => {
    const geometry = bakeFacetColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), '#808080', { rng: createSeededRng(3), jitter: 0.2 })
    const color    = geometry.attributes.color as THREE.BufferAttribute

    expect(color.count).toBe((geometry.attributes.position as THREE.BufferAttribute).count)
    for (let i = 0; i < color.count; i += 3) {
      // the three corners of a facet must agree, or flat shading smears the jitter
      expect(color.getX(i + 1)).toBeCloseTo(color.getX(i), 6)
      expect(color.getX(i + 2)).toBeCloseTo(color.getX(i), 6)
    }
    geometry.dispose()
  })

  it('varies facets with an rng and leaves them flat without one', () => {
    const shades = (rng?: ReturnType<typeof createSeededRng>): number[] => {
      const geometry      = bakeFacetColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), '#808080', { rng, jitter: 0.3 })
      const color         = geometry.attributes.color as THREE.BufferAttribute
      const out: number[] = []
      for (let i = 0; i < color.count; i += 3)
        out.push(color.getX(i))
      geometry.dispose()
      return out
    }

    expect(new Set(shades()).size).toBe(1)
    expect(new Set(shades(createSeededRng(9))).size).toBeGreaterThan(4)
    expect(shades(createSeededRng(9))).toEqual(shades(createSeededRng(9)))
  })
})

describe('applyGrime', () => {
  it('darkens toward the base and leaves the top alone', () => {
    const geometry = bakeFacetColors(new THREE.BoxGeometry(1, 2, 1).toNonIndexed(), '#ffffff')
    // fully clean at y = height, so a box spanning -1..1 is clean at its top
    applyGrime(geometry, { height: 1, floor: 0.5 })

    const position = geometry.attributes.position as THREE.BufferAttribute
    const color    = geometry.attributes.color as THREE.BufferAttribute
    let bottom = 1
    let top    = 0

    for (let i = 0; i < position.count; i++)
      if (position.getY(i) < 0)
        bottom = Math.min(bottom, color.getX(i))
      else
        top = Math.max(top, color.getX(i))

    expect(bottom).toBeCloseTo(0.5, 5) // the base sits exactly at the floor
    expect(top).toBeCloseTo(1, 5)
    geometry.dispose()
  })
})

describe('part and mergeParts', () => {
  it('transforms a primitive and bakes its colour', () => {
    const geometry = part(new THREE.BoxGeometry(1, 1, 1), { at: [ 0, 2, 0 ], scale: 2, color: '#ff0000' })
    const box      = extentOf(geometry)

    expect(geometry.index).toBeNull()
    expect(box.min.y).toBeCloseTo(1, 5)
    expect(box.max.y).toBeCloseTo(3, 5)
    expect((geometry.attributes.color as THREE.BufferAttribute).getX(0)).toBeCloseTo(1, 5)
    geometry.dispose()
  })

  it('applies scale before rotation, so a tall post lies down', () => {
    const geometry = part(new THREE.BoxGeometry(1, 1, 1), { scale: [ 0.2, 2, 0.2 ], rotate: [ Math.PI / 2, 0, 0 ]})
    const size     = extentOf(geometry).getSize(new THREE.Vector3())

    expect(size.y).toBeCloseTo(0.2, 5)
    expect(size.z).toBeCloseTo(2, 5)
    geometry.dispose()
  })

  it('merges parts into one geometry and disposes the originals', () => {
    const a      = part(new THREE.BoxGeometry(1, 1, 1), { at: [ -1, 0.5, 0 ]})
    const b      = part(new THREE.BoxGeometry(1, 1, 1), { at: [ 1, 0.5, 0 ]})
    const counts = (a.attributes.position as THREE.BufferAttribute).count + (b.attributes.position as THREE.BufferAttribute).count

    let disposed = 0
    a.addEventListener('dispose', () => {
      disposed++
    })
    b.addEventListener('dispose', () => {
      disposed++
    })

    const merged = mergeParts([ a, b ])
    expect((merged.attributes.position as THREE.BufferAttribute).count).toBe(counts)
    expect(merged.attributes.color).toBeDefined()
    expect(disposed).toBe(2)
    expect(extentOf(merged).getSize(new THREE.Vector3()).x).toBeCloseTo(3, 5)
    merged.dispose()
  })

  it('refuses to merge nothing', () => {
    expect(() => mergeParts([])).toThrow(/nothing to merge/)
  })
})

describe('the wasteland kit', () => {
  it.each(KIT_PROP_NAMES.map(name => [ name ] as const))('builds "%s" as one grounded, coloured geometry', (name: KitPropName) => {
    const geometry = buildKitGeometry(name)
    const box      = extentOf(geometry)
    const size     = box.getSize(new THREE.Vector3())

    expect(geometry.index).toBeNull()
    expect(geometry.attributes.color).toBeDefined()
    expect((geometry.attributes.position as THREE.BufferAttribute).count).toBeGreaterThan(0)

    // props stand ON the ground — a little below it for the ones meant to be
    // half-buried (crags, rubble) — and are prop-sized, not scenery-sized
    expect(box.min.y).toBeGreaterThan(-3)
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(14)
    geometry.dispose()
  })

  it('is deterministic without an rng and varied with one', () => {
    const points = (geometry: THREE.BufferGeometry): number[] => [ ...(geometry.attributes.position as THREE.BufferAttribute).array ]

    const first  = buildKitGeometry('crag')
    const second = buildKitGeometry('crag')
    expect(points(first)).toEqual(points(second))

    const rng    = createSeededRng(4)
    const varied = [ buildKitGeometry('crag', { rng }), buildKitGeometry('crag', { rng }) ]
    expect(points(varied[0] as THREE.BufferGeometry)).not.toEqual(points(varied[1] as THREE.BufferGeometry))

    // …but the same seed replays the same sequence
    const replay = createSeededRng(4)
    const again  = buildKitGeometry('crag', { rng: replay })
    expect(points(again)).toEqual(points(varied[0] as THREE.BufferGeometry))

    for (const geometry of [ first, second, again, ...varied ])
      geometry.dispose()
  })

  it('recolours through the palette', () => {
    const geometry = buildKitGeometry('container', { palette: { panel: '#ff0000' }})
    const color    = geometry.attributes.color as THREE.BufferAttribute

    let reddest = 0
    for (let i = 0; i < color.count; i++)
      reddest = Math.max(reddest, color.getX(i) - color.getY(i))

    expect(reddest).toBeGreaterThan(0.8)
    expect(KIT_PALETTE.panel).toBe('#c4bcb0') // the default is untouched
    geometry.dispose()
  })

  it('wraps a prop that owns its geometry but never a shared material', () => {
    const shared = kitMaterial()
    const prop   = kitProp('watchtower', { material: shared })
    const mesh   = prop.part('body') as THREE.Mesh

    let materialDisposals = 0
    let geometryDisposals = 0
    shared.addEventListener('dispose', () => {
      materialDisposals++
    })
    mesh.geometry.addEventListener('dispose', () => {
      geometryDisposals++
    })

    expect(mesh.castShadow).toBe(true)
    prop.dispose()

    expect(geometryDisposals).toBe(1)
    expect(materialDisposals).toBe(0) // the kit still needs it
    shared.dispose()
  })
})

describe('createPlacementField', () => {
  it('never places two things closer than their radii', () => {
    const field                             = createPlacementField({ rng: createSeededRng(11), extent: 30 })
    const spots: { x: number, z: number }[] = []

    for (let i = 0; i < 40; i++) {
      const spot = field.place({ radius: 2 })
      if (spot)
        spots.push(spot)
    }

    expect(spots.length).toBeGreaterThan(20)
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i] as { x: number, z: number }
        const b = spots[j] as { x: number, z: number }
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4)
      }
  })

  it('honours the corridor, the range, and the ground rules', () => {
    const field = createPlacementField({
      rng:       createSeededRng(5),
      extent:    40,
      heightAt:  (x, z) => Math.hypot(x, z) < 20 ? -5 : 1, // a lake in the middle
      minHeight: 0,
    })

    for (let i = 0; i < 30; i++) {
      const spot = field.place({ radius: 0.5, minDistance: 6, maxDistance: 35, avoidCorridor: 5 })
      if (!spot)
        continue

      expect(Math.abs(spot.x)).toBeGreaterThan(5)
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThanOrEqual(6)
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(20) // out of the lake
    }
  })

  it('gives up rather than overlapping when the field is full', () => {
    const field = createPlacementField({ rng: createSeededRng(2), extent: 3 })
    expect(field.place({ radius: 2.5 })).not.toBeNull()
    expect(field.place({ radius: 2.5, attempts: 200 })).toBeNull()
  })

  it('respects claims made before it starts', () => {
    const field = createPlacementField({ rng: createSeededRng(8), extent: 6, claims: [{ x: 0, z: 0, radius: 5.5 }]})
    const spot  = field.place({ radius: 1 })

    expect(spot === null || Math.hypot(spot.x, spot.z) > 6.5).toBe(true)
  })
})

describe('scatterInstances', () => {
  it('fills one instanced mesh and tints per instance', () => {
    const geometry         = buildKitGeometry('barrel-cluster')
    const material         = kitMaterial()
    const { mesh, placed } = scatterInstances({
      geometry,
      material,
      count: 5,
      place: index => index === 3 ? null : { at: [ index * 2, 0, 0 ], rotate: [ 0, index, 0 ], scale: 1.2, tint: '#ff0000' },
    })

    expect(mesh.count).toBe(5)
    expect(placed).toBe(4)
    expect(mesh.instanceColor).not.toBeNull()

    const matrix = new THREE.Matrix4()
    const at     = new THREE.Vector3()
    mesh.getMatrixAt(2, matrix)
    at.setFromMatrixPosition(matrix)
    expect(at.x).toBeCloseTo(4, 5)

    // the skipped slot is scaled away, not left at full size in the wrong place
    mesh.getMatrixAt(3, matrix)
    expect(new THREE.Vector3().setFromMatrixScale(matrix)
      .length()).toBeCloseTo(0, 6)

    mesh.dispose()
    geometry.dispose()
    material.dispose()
  })
})
