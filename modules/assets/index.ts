// modules/assets/index.ts
// The content layer: materials, procedural textures, and props. Unlike the
// lighting/orbit/post modules these are plain factories rather than AppModules
// — content is what you put *into* a scene, not behaviour you mount onto it.
//
// Everything here is deterministic and DOM-free (textures are DataTextures, not
// canvases), so it builds identically in a headless test and in the browser.

// the group-of-meshes primitive + its ownership rules
export { Prop, markShared, ownsResource } from './prop.js'

// materials — tuned PBR presets, toon shading
export { createStandardMaterial, createToonMaterial, createGradientRamp, MATERIAL_PRESETS } from './materials.js'
export type { MaterialPreset, MaterialPresetParams, ToonMaterialOptions } from './materials.js'

// textures — seeded, procedural, headless-safe
export { createGridTexture, createNoiseTexture, createGradientTexture } from './textures.js'
export type { GridTextureOptions, NoiseTextureOptions, GradientTextureOptions } from './textures.js'

// props — a starter catalogue built on Prop
export { crystalProp, rockProp, treeProp, boatProp, cloudProp, lampPostProp } from './props.js'
export type { PropOptions, CrystalOptions, RockOptions, TreeOptions, BoatOptions, CloudOptions, LampPostOptions } from './props.js'

// the low-poly look — baked facet colours, grime, and the one shared material
export { bakeFacetColors, applyGrime, kitMaterial } from './facets.js'
export type { FacetColorOptions, GrimeOptions } from './facets.js'

// building props out of primitives, then collapsing them into one geometry
export { part, mergeParts } from './parts.js'
export type { PartOptions, MergePartsOptions } from './parts.js'

// the wasteland kit — fourteen props, each one merged geometry
export { buildKitGeometry, kitProp, KIT_PROP_NAMES, KIT_PALETTE } from './kit.js'
export type { KitOptions, KitPaletteKey, KitPropName } from './kit.js'

// placement solver + instanced scatter
export { createPlacementField, scatterInstances } from './scatter.js'
export type {
  Claim,
  InstancePlacement,
  PlacementField,
  PlacementFieldOptions,
  PlacementQuery,
  ScatterOptions,
  ScatterResult,
} from './scatter.js'
