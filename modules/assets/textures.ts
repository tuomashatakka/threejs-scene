// modules/assets/textures.ts
// Procedural textures built as DataTextures — no canvas, no DOM, no network.
// That keeps them usable in headless tests and during SSR/build, and makes them
// deterministic: the same seed always produces the same pixels, so a scene
// replays identically.

import * as THREE from 'three'

import { mulberry32 } from '../../lib/index'


/** Options shared by the procedural texture factories. */
export interface ProceduralTextureOptions {

  /** Texture edge length in texels (square). @defaultValue 256 */
  size?: number

  /** Deterministic seed. @defaultValue 1 */
  seed?: number
}

function finish (texture: THREE.DataTexture, size: number): THREE.DataTexture {
  texture.wrapS       = THREE.RepeatWrapping
  texture.wrapT       = THREE.RepeatWrapping
  texture.colorSpace  = THREE.SRGBColorSpace
  texture.needsUpdate = true
  // mipmaps need power-of-two dimensions to be worth generating
  texture.generateMipmaps = (size & size - 1) === 0
  return texture
}

/** Options for {@link createGridTexture}. */
export interface GridTextureOptions extends ProceduralTextureOptions {

  /** Grid cells across the texture. @defaultValue 8 */
  cells?: number

  /** Line thickness in texels. @defaultValue 2 */
  lineWidth?: number

  /** Cell fill colour. @defaultValue '#1b1e26' */
  background?: THREE.ColorRepresentation

  /** Grid line colour. @defaultValue '#39404e' */
  line?: THREE.ColorRepresentation
}

/**
 * A tiling grid — the default surface for procedural/greybox geometry.
 *
 * @returns A repeating {@link THREE.DataTexture}. Set `.repeat` to tile it further.
 */
export function createGridTexture ({
  size = 256,
  cells = 8,
  lineWidth = 2,
  background = '#1b1e26',
  line = '#39404e',
}: GridTextureOptions = {}): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const bg   = new THREE.Color(background)
  const fg   = new THREE.Color(line)
  const step = size / cells

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const onLine = x % step < lineWidth || y % step < lineWidth
      const c      = onLine ? fg : bg
      const i      = (y * size + x) * 4
      data[i]      = Math.round(c.r * 255)
      data[i + 1]  = Math.round(c.g * 255)
      data[i + 2]  = Math.round(c.b * 255)
      data[i + 3]  = 255
    }

  return finish(new THREE.DataTexture(data, size, size), size)
}

/** Options for {@link createNoiseTexture}. */
export interface NoiseTextureOptions extends ProceduralTextureOptions {

  /** Blend toward white; 0 = full-range noise, 1 = flat white. @defaultValue 0 */
  lift?: number

  /** Emit greyscale noise (same value per channel) rather than per-channel. @defaultValue true */
  monochrome?: boolean
}

/**
 * Seeded value noise — roughness/detail maps, grain, scatter masks.
 *
 * @returns A repeating {@link THREE.DataTexture}. Identical for a given `seed`.
 */
export function createNoiseTexture ({
  size = 256,
  seed = 1,
  lift = 0,
  monochrome = true,
}: NoiseTextureOptions = {}): THREE.DataTexture {
  const random = mulberry32(seed)
  const data   = new Uint8Array(size * size * 4)

  for (let i = 0; i < size * size; i++) {
    const base     = i * 4
    const v        = () => Math.round((lift + (1 - lift) * random()) * 255)
    const g        = v()
    data[base]     = monochrome ? g : v()
    data[base + 1] = monochrome ? g : v()
    data[base + 2] = monochrome ? g : v()
    data[base + 3] = 255
  }

  return finish(new THREE.DataTexture(data, size, size), size)
}

/** Options for {@link createGradientTexture}. */
export interface GradientTextureOptions extends ProceduralTextureOptions {

  /** Colour at v = 0. @defaultValue '#0a0a14' */
  from?: THREE.ColorRepresentation

  /** Colour at v = 1. @defaultValue '#79f7ff' */
  to?: THREE.ColorRepresentation
}

/**
 * A vertical two-stop gradient — sky backdrops, product-studio sweeps, ramps.
 *
 * @returns A {@link THREE.DataTexture} interpolating `from` → `to` along v.
 */
export function createGradientTexture ({
  size = 128,
  from = '#0a0a14',
  to = '#79f7ff',
}: GradientTextureOptions = {}): THREE.DataTexture {
  const data  = new Uint8Array(size * size * 4)
  const start = new THREE.Color(from)
  const end   = new THREE.Color(to)
  const mixed = new THREE.Color()

  for (let y = 0; y < size; y++) {
    mixed.copy(start).lerp(end, y / (size - 1))
    for (let x = 0; x < size; x++) {
      const i     = (y * size + x) * 4
      data[i]     = Math.round(mixed.r * 255)
      data[i + 1] = Math.round(mixed.g * 255)
      data[i + 2] = Math.round(mixed.b * 255)
      data[i + 3] = 255
    }
  }

  return finish(new THREE.DataTexture(data, size, size), size)
}

// perf: cheap, but each texture is size² × 4 bytes on the GPU. Build once and
// share; dispose on teardown.
