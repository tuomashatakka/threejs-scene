// modules/assets/textures.ts
// Procedural textures built as DataTextures — no canvas, no DOM, no network.
// That keeps them usable in headless tests and during SSR/build, and makes them
// deterministic: the same seed always produces the same pixels, so a scene
// replays identically.

import * as THREE from 'three'

import { hash3, lerp, mulberry32, smoothstep } from '../../lib/index.js'


/** Options shared by the procedural texture factories. */
export interface ProceduralTextureOptions {

  /** Texture edge length in texels (square). @defaultValue 256 */
  size?: number

  /** Deterministic seed. @defaultValue 1 */
  seed?: number
}

function textureSize (value: number, fallback: number): number {
  return Math.max(2, Math.min(2048, Math.round(Number.isFinite(value) ? value : fallback)))
}

function finish (texture: THREE.DataTexture, size: number, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace): THREE.DataTexture {
  texture.wrapS       = THREE.RepeatWrapping
  texture.wrapT       = THREE.RepeatWrapping
  texture.colorSpace  = colorSpace
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
  size = textureSize(size, 256)
  cells = Math.max(1, Math.round(Number.isFinite(cells) ? cells : 8))
  lineWidth = Math.max(0, Number.isFinite(lineWidth) ? lineWidth : 2)

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
  size = textureSize(size, 256)
  lift = THREE.MathUtils.clamp(Number.isFinite(lift) ? lift : 0, 0, 1)

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
  size = textureSize(size, 128)

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

/** Options for {@link createSeamlessNoiseTexture}. */
export interface SeamlessNoiseTextureOptions extends ProceduralTextureOptions {

  /** Base number of periodic cells across the tile. @defaultValue 4 */
  frequency?: number

  /** Fractal value-noise layers. @defaultValue 4 */
  octaves?: number
}

function periodicNoise (x: number, y: number, period: number, seed: number): number {
  const x0   = Math.floor(x)
  const y0   = Math.floor(y)
  const fx   = smoothstep(0, 1, x - x0)
  const fy   = smoothstep(0, 1, y - y0)
  const wrap = (value: number): number => (value % period + period) % period
  const a    = hash3(wrap(x0), wrap(y0), seed)
  const b    = hash3(wrap(x0 + 1), wrap(y0), seed)
  const c    = hash3(wrap(x0), wrap(y0 + 1), seed)
  const d    = hash3(wrap(x0 + 1), wrap(y0 + 1), seed)
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
}

/**
 * Seeded, seamlessly tileable fractal noise. Opposite edge texels are exactly
 * equal, so repeating it cannot reveal a seam.
 */
export function createSeamlessNoiseTexture ({
  size = 256,
  seed = 1,
  frequency = 4,
  octaves = 4,
}: SeamlessNoiseTextureOptions = {}): THREE.DataTexture {
  size = textureSize(size, 256)
  frequency = Math.max(1, Math.round(Number.isFinite(frequency) ? frequency : 4))
  octaves = Math.max(1, Math.min(8, Math.round(Number.isFinite(octaves) ? octaves : 4)))

  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1)
      const v = y / (size - 1)
      let value         = 0
      let amplitude     = 1
      let normalization = 0
      let period        = frequency
      for (let octave = 0; octave < octaves; octave++) {
        value += periodicNoise(u * period, v * period, period, seed + octave * 101) * amplitude
        normalization += amplitude
        amplitude *= 0.5
        period *= 2
      }

      const shade     = Math.round(value / normalization * 255)
      const index     = (y * size + x) * 4
      data[index]     = shade
      data[index + 1] = shade
      data[index + 2] = shade
      data[index + 3] = 255
    }

  return finish(new THREE.DataTexture(data, size, size), size, THREE.NoColorSpace)
}

/** Options for {@link createMatcapTexture}. */
export interface MatcapTextureOptions extends ProceduralTextureOptions {
  shadow?:    THREE.ColorRepresentation
  base?:      THREE.ColorRepresentation
  highlight?: THREE.ColorRepresentation
}

/** Procedural studio-light matcap with no image or DOM dependency. */
export function createMatcapTexture ({
  size = 128,
  shadow = '#17202c',
  base = '#6f86a3',
  highlight = '#f6fbff',
}: MatcapTextureOptions = {}): THREE.DataTexture {
  size = textureSize(size, 128)

  const data   = new Uint8Array(size * size * 4)
  const dark   = new THREE.Color(shadow)
  const middle = new THREE.Color(base)
  const light  = new THREE.Color(highlight)
  const color  = new THREE.Color()

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx       = x / (size - 1) * 2 - 1
      const ny       = y / (size - 1) * 2 - 1
      const radius2  = nx * nx + ny * ny
      const nz       = Math.sqrt(Math.max(0, 1 - radius2))
      const diffuse  = THREE.MathUtils.clamp(nx * -0.28 + ny * 0.45 + nz * 0.8, 0, 1)
      const specular = Math.max(0, 1 - Math.hypot(nx + 0.3, ny - 0.32) * 3.3) ** 3
      color.copy(dark).lerp(middle, diffuse)
        .lerp(light, specular)

      const index     = (y * size + x) * 4
      data[index]     = Math.round(color.r * 255)
      data[index + 1] = Math.round(color.g * 255)
      data[index + 2] = Math.round(color.b * 255)
      data[index + 3] = 255
    }

  const texture = finish(new THREE.DataTexture(data, size, size), size)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

// perf: cheap, but each texture is size² × 4 bytes on the GPU. Build once and
// share; dispose on teardown.
