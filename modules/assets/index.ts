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
export { createStandardMaterial, createToonMaterial, createGradientRamp, createMatcapMaterial, MATERIAL_PRESETS } from './materials.js'
export type { MaterialPreset, MaterialPresetParams, ToonMaterialOptions } from './materials.js'
export { createHolographicMaterial } from './holographic-material.js'
export type { HolographicMaterialOptions, TickableMaterial } from './holographic-material.js'
export { createTriplanarMaterial } from './triplanar-material.js'
export type { TriplanarMaterialOptions } from './triplanar-material.js'

// textures — seeded, procedural, headless-safe
export {
  createGridTexture,
  createNoiseTexture,
  createGradientTexture,
  createSeamlessNoiseTexture,
  createMatcapTexture,
} from './textures.js'
export type {
  GradientTextureOptions,
  GridTextureOptions,
  MatcapTextureOptions,
  NoiseTextureOptions,
  ProceduralTextureOptions,
  SeamlessNoiseTextureOptions,
} from './textures.js'

// props — a starter catalogue built on Prop
export { crystalProp, rockProp, treeProp, boatProp, cloudProp, lampPostProp } from './props.js'
export type { PropOptions, CrystalOptions, RockOptions, TreeOptions, BoatOptions, CloudOptions, LampPostOptions } from './props.js'

// the low-poly look — baked facet colours, grime, and the one shared material
export { bakeFacetColors, applyGrime, kitMaterial } from './facets.js'
export type { FacetColorOptions, GrimeOptions } from './facets.js'

// building props out of primitives, then collapsing them into one geometry
export { part, mergeParts } from './parts.js'
export type { PartOptions, MergePartsOptions } from './parts.js'

// terse constructors for the primitives a prop is built from
export { box, cyl, cone, ball, hedron, plank, blade, deg, spread } from './primitives.js'

// seeing a built geometry without a browser — the other half of reviewProp
export { rasterizeAscii, auditPalette, ASCII_VIEWS, ASCII_SHADES } from './ascii.js'
export type {
  AsciiRasterOptions,
  AsciiRasterResult,
  AsciiView,
  AsciiViewName,
  PaletteAuditEntry,
} from './ascii.js'

// the wasteland kit — sixteen props, each one merged geometry
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

// geometry authoring — profiles, sweeps, modifiers, merging, layouts, graphs,
// path tubes, terrain, and rounded procedural rocks
export * from './geometry/index.js'

// serializable parameter contracts and synchronous procedural prop definitions
export { resolveParam, resolveParams } from './params.js'
export type { ParamSpec, ParamSpecMap, ParamValue } from './params.js'
export { defineProp, buildPropDefinition } from './definition.js'
export type { PropDefinition, ResolvedPropOptions } from './definition.js'
export { PROP_DEFINITIONS, PROP_PRESET_NAMES } from './presets.js'
export { createPropRegistry } from './registry.js'
export type { PropRegistry } from './registry.js'

// the llm-first front door and never-throw alternative
export { createProp, tryCreateProp } from './create.js'
export type { CreatePropAttempt, CreatePropInput, PropPresetRequest } from './create.js'

// composition and one-instanced-mesh-per-part batching
export { createPropComposite } from './composite.js'
export type { CompositePart, PropComposite } from './composite.js'
export { createInstancedProp } from './instanced.js'
export type { InstancePlace, InstancedPropOptions, InstancedPropResult } from './instanced.js'

// executable preset catalog + matching serializable discovery manifest/schema
export {
  ASSET_MANIFEST,
  CREATE_PROP_SCHEMA,
  MATERIAL_PRESET_NAMES,
  TEXTURE_PRESET_NAMES,
  createMaterialPreset,
  createTexturePreset,
} from './catalog.js'
export type { AssetManifestEntry, AssetMaterialPresetName, TexturePresetName } from './catalog.js'

// migrated model-authored spec/validation/build/review/prompt/retry surface
export * from './authoring/index.js'
