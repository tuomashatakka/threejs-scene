import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { bakeAlphaField } from 'ꭍ/assets'


describe('bakeAlphaField', () => {
  it('produces the requested dimensions as RGBA', () => {
    const texture = bakeAlphaField(16, () => {})
    const image   = texture.image as { width: number, height: number, data: Uint8Array }

    expect(image.width).toBe(16)
    expect(image.height).toBe(16)
    expect(image.data).toBeInstanceOf(Uint8Array)
    expect(image.data.length).toBe(16 * 16 * 4)
    expect(texture.format).toBe(THREE.RGBAFormat)
  })

  it('hands the sampler the buffer it will upload, exactly once', () => {
    const sampler = vi.fn((field: Uint8Array) => {
      field[3] = 200
    })

    const texture = bakeAlphaField(8, sampler)
    const image   = texture.image as { data: Uint8Array }

    expect(sampler).toHaveBeenCalledTimes(1)
    expect(sampler.mock.calls[0]![0]).toBe(image.data)
    expect(image.data[3]).toBe(200)
  })

  it('mirrors by default, because a scrolled sheet reveals a plain-repeat seam', () => {
    const texture = bakeAlphaField(8, () => {})

    expect(texture.wrapS).toBe(THREE.MirroredRepeatWrapping)
    expect(texture.wrapT).toBe(THREE.MirroredRepeatWrapping)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.minFilter).toBe(THREE.LinearFilter)
    // `needsUpdate` is a setter with no getter — it bumps `version`, which is
    // the half three actually reads when deciding whether to upload.
    expect(texture.version).toBeGreaterThan(0)
  })

  it('takes an explicit wrap mode on both axes', () => {
    const texture = bakeAlphaField(8, () => {}, { wrap: THREE.RepeatWrapping })

    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
  })

  it('leaves the colour space alone unless asked, and sets it when asked', () => {
    const plain  = bakeAlphaField(8, () => {})
    const graded = bakeAlphaField(8, () => {}, { colorSpace: THREE.SRGBColorSpace })

    expect(plain.colorSpace).toBe(THREE.NoColorSpace)
    expect(graded.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('is deterministic for a deterministic sampler', () => {
    const paint = (field: Uint8Array): void => {
      for (let i = 0; i < field.length; i += 1)
        field[i] = i * 31 % 256
    }

    const a = bakeAlphaField(8, paint).image as { data: Uint8Array }
    const b = bakeAlphaField(8, paint).image as { data: Uint8Array }

    expect([ ...a.data ]).toEqual([ ...b.data ])
  })
})
