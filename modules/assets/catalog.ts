import * as THREE from 'three'

import { createHolographicMaterial } from './holographic-material.js'
import { createMatcapMaterial, createStandardMaterial, createToonMaterial, MATERIAL_PRESETS } from './materials.js'
import { resolveParams } from './params.js'
import { PROP_DEFINITIONS, PROP_PRESET_NAMES } from './presets.js'
import {
  createGradientTexture,
  createGridTexture,
  createMatcapTexture,
  createNoiseTexture,
  createSeamlessNoiseTexture,
} from './textures.js'
import { createTriplanarMaterial } from './triplanar-material.js'
import { PROP_SPEC_SCHEMA } from './authoring/schema.js'

import type { MaterialPreset } from './materials.js'
import type { ParamSpecMap, ParamValue } from './params.js'
import type { JsonSchema } from './authoring/schema.js'


export interface AssetManifestEntry {
  readonly name:        string
  readonly description: string
  readonly tags:        readonly string[]
  readonly options:     ParamSpecMap
}

interface ExecutablePreset<T> extends AssetManifestEntry {
  create (options: Readonly<Record<string, ParamValue>>): T
}

export const TEXTURE_PRESET_NAMES = [ 'grid', 'noise', 'gradient', 'seamless-noise', 'matcap' ] as const
export type TexturePresetName = (typeof TEXTURE_PRESET_NAMES)[number]

const texturePresets: Record<TexturePresetName, ExecutablePreset<THREE.DataTexture>> = {
  'grid': {
    name:        'grid',
    description: 'repeatable procedural construction grid',
    tags:        [ 'surface', 'tiling', 'debug' ],
    options:     {
      size:       { kind: 'int', default: 256, min: 2, max: 2048 },
      cells:      { kind: 'int', default: 8, min: 1, max: 256 },
      lineWidth:  { kind: 'number', default: 2, min: 0, max: 64 },
      background: { kind: 'string', default: '#1b1e26' },
      line:       { kind: 'string', default: '#39404e' },
    },
    create: options => createGridTexture(options),
  },
  'noise': {
    name:        'noise',
    description: 'seeded pixel noise for roughness, grain, and masks',
    tags:        [ 'surface', 'noise', 'mask' ],
    options:     {
      size:       { kind: 'int', default: 256, min: 2, max: 2048 },
      seed:       { kind: 'int', default: 1, min: 0, max: 2_147_483_647 },
      lift:       { kind: 'number', default: 0, min: 0, max: 1 },
      monochrome: { kind: 'boolean', default: true },
    },
    create: options => createNoiseTexture(options),
  },
  'gradient': {
    name:        'gradient',
    description: 'vertical two-stop color gradient',
    tags:        [ 'backdrop', 'ramp', 'color' ],
    options:     {
      size: { kind: 'int', default: 128, min: 2, max: 2048 },
      from: { kind: 'string', default: '#0a0a14' },
      to:   { kind: 'string', default: '#79f7ff' },
    },
    create: options => createGradientTexture(options),
  },
  'seamless-noise': {
    name:        'seamless-noise',
    description: 'seeded fractal value noise with exactly matching tile edges',
    tags:        [ 'surface', 'noise', 'seamless' ],
    options:     {
      size:      { kind: 'int', default: 256, min: 2, max: 2048 },
      seed:      { kind: 'int', default: 1, min: 0, max: 2_147_483_647 },
      frequency: { kind: 'int', default: 4, min: 1, max: 64 },
      octaves:   { kind: 'int', default: 4, min: 1, max: 8 },
    },
    create: options => createSeamlessNoiseTexture(options),
  },
  'matcap': {
    name:        'matcap',
    description: 'procedural studio-light matcap',
    tags:        [ 'lighting', 'stylized', 'matcap' ],
    options:     {
      size:      { kind: 'int', default: 128, min: 2, max: 2048 },
      shadow:    { kind: 'string', default: '#17202c' },
      base:      { kind: 'string', default: '#6f86a3' },
      highlight: { kind: 'string', default: '#f6fbff' },
    },
    create: options => createMatcapTexture(options),
  },
}

/** Create any manifest texture preset after clamping/defaulting its options. */
export function createTexturePreset (
  name: string,
  options: Readonly<Record<string, unknown>> = {},
): THREE.DataTexture {
  const preset = texturePresets[name as TexturePresetName]
  if (!preset)
    throw new Error(`createTexturePreset: unknown preset "${name}"`)
  return preset.create(resolveParams(preset.options, options))
}

export const MATERIAL_PRESET_NAMES = [
  'metal', 'chrome', 'gold', 'plastic', 'rubber', 'matte', 'emissive', 'glass',
  'toon', 'matcap', 'holographic', 'triplanar',
] as const
export type AssetMaterialPresetName = (typeof MATERIAL_PRESET_NAMES)[number]

const materialDescriptions: Record<MaterialPreset, string> = {
  metal:    'brushed neutral metal',
  chrome:   'polished mirror-like chrome',
  gold:     'warm polished gold',
  plastic:  'balanced colored plastic',
  rubber:   'dark high-roughness rubber',
  matte:    'fully rough neutral surface',
  emissive: 'self-lit emissive surface',
  glass:    'transmissive physical glass',
}

function colorDefault (preset: MaterialPreset): string {
  const color = MATERIAL_PRESETS[preset].color
  return typeof color === 'string' ? color : '#ffffff'
}

function pbrPreset (name: MaterialPreset): ExecutablePreset<THREE.Material> {
  const base                                          = MATERIAL_PRESETS[name]
  const options: Record<string, ParamSpecMap[string]> = {
    color:     { kind: 'string', default: colorDefault(name) },
    metalness: { kind: 'number', default: base.metalness ?? 0, min: 0, max: 1 },
    roughness: { kind: 'number', default: base.roughness ?? 1, min: 0, max: 1 },
  }
  if (name === 'emissive') {
    options.emissive          = { kind: 'string', default: '#79f7ff' }
    options.emissiveIntensity = { kind: 'number', default: 2.5, min: 0, max: 20 }
  }
  if (name === 'glass') {
    options.transmission = { kind: 'number', default: 1, min: 0, max: 1 }
    options.thickness    = { kind: 'number', default: 0.6, min: 0, max: 10 }
    options.ior          = { kind: 'number', default: 1.5, min: 1, max: 2.333 }
  }
  return {
    name,
    description: materialDescriptions[name],
    tags:        [ 'pbr', name ],
    options,
    create:      values => createStandardMaterial(name, values as THREE.MeshPhysicalMaterialParameters),
  }
}

const materialPresets: Record<AssetMaterialPresetName, ExecutablePreset<THREE.Material>> = {
  metal:    pbrPreset('metal'),
  chrome:   pbrPreset('chrome'),
  gold:     pbrPreset('gold'),
  plastic:  pbrPreset('plastic'),
  rubber:   pbrPreset('rubber'),
  matte:    pbrPreset('matte'),
  emissive: pbrPreset('emissive'),
  glass:    pbrPreset('glass'),
  toon:     {
    name:        'toon',
    description: 'cel-shaded material with a quantized light ramp',
    tags:        [ 'stylized', 'cel', 'non-pbr' ],
    options:     {
      color: { kind: 'string', default: '#ff7ad9' },
      steps: { kind: 'int', default: 4, min: 2, max: 16 },
    },
    create: options => createToonMaterial(options),
  },
  matcap: {
    name:        'matcap',
    description: 'view-space studio shading from a procedural matcap',
    tags:        [ 'stylized', 'matcap', 'non-pbr' ],
    options:     {
      size:      { kind: 'int', default: 128, min: 2, max: 2048 },
      shadow:    { kind: 'string', default: '#17202c' },
      base:      { kind: 'string', default: '#6f86a3' },
      highlight: { kind: 'string', default: '#f6fbff' },
    },
    create: options => createMatcapMaterial(createMatcapTexture(options)),
  },
  holographic: {
    name:        'holographic',
    description: 'animated fresnel hologram with scanlines',
    tags:        [ 'shader', 'animated', 'emissive' ],
    options:     {
      baseColor:       { kind: 'string', default: '#79f7ff' },
      fresnelStrength: { kind: 'number', default: 2, min: 0, max: 10 },
      scanlineDensity: { kind: 'number', default: 40, min: 0, max: 200 },
      opacity:         { kind: 'number', default: 1, min: 0, max: 1 },
    },
    create: options => createHolographicMaterial(options),
  },
  triplanar: {
    name:        'triplanar',
    description: 'analytic world-space grid without uv seams',
    tags:        [ 'shader', 'procedural', 'uv-free' ],
    options:     {
      colorA:      { kind: 'string', default: '#2c3244' },
      colorB:      { kind: 'string', default: '#3c4a66' },
      accent:      { kind: 'string', default: '#79f7ff' },
      tileScale:   { kind: 'number', default: 0.4, min: 0.0001, max: 100 },
      fogDistance: { kind: 'number', default: 40, min: 0.0001, max: 10_000 },
    },
    create: options => createTriplanarMaterial({
      palette:     [ options.colorA as string, options.colorB as string, options.accent as string ],
      tileScale:   options.tileScale as number,
      fogDistance: options.fogDistance as number,
    }),
  },
}

/** Create any manifest material preset after clamping/defaulting its options. */
export function createMaterialPreset (
  name: string,
  options: Readonly<Record<string, unknown>> = {},
): THREE.Material {
  const preset = materialPresets[name as AssetMaterialPresetName]
  if (!preset)
    throw new Error(`createMaterialPreset: unknown preset "${name}"`)
  return preset.create(resolveParams(preset.options, options))
}

function manifestEntry (preset: AssetManifestEntry): AssetManifestEntry {
  return {
    name:        preset.name,
    description: preset.description,
    tags:        [ ...preset.tags ],
    options:     { ...preset.options },
  }
}

/** Serializable discovery surface used by llms, docs, and the asset gallery. */
export const ASSET_MANIFEST = {
  version:   1,
  textures:  TEXTURE_PRESET_NAMES.map(name => manifestEntry(texturePresets[name])),
  materials: MATERIAL_PRESET_NAMES.map(name => manifestEntry(materialPresets[name])),
  props:     PROP_DEFINITIONS.map(definition => manifestEntry({
    name:        definition.name,
    description: definition.description,
    tags:        definition.tags,
    options:     definition.parameters,
  })),
}

/** Function-calling schema for either a preset request or a freeform prop spec. */
export const CREATE_PROP_SCHEMA: JsonSchema = {
  oneOf: [
    { type: 'string', enum: PROP_PRESET_NAMES, description: 'Exact built-in prop preset name.' },
    {
      type:       'object',
      properties: {
        preset:  { type: 'string', enum: PROP_PRESET_NAMES },
        options: { type: 'object', additionalProperties: true },
      },
      required:             [ 'preset' ],
      additionalProperties: false,
    },
    PROP_SPEC_SCHEMA,
  ],
}

// perf: registries are static data. Factories run only when explicitly called.
