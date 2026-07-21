// modules/assets/index.ts
// The content layer: materials, procedural textures, and props. Unlike the
// lighting/orbit/post modules these are plain factories rather than AppModules
// — content is what you put *into* a scene, not behaviour you mount onto it.
//
// Everything here is deterministic and DOM-free (textures are DataTextures, not
// canvases), so it builds identically in a headless test and in the browser.

// the group-of-meshes primitive + its ownership rules
export { Prop, markShared, ownsResource } from './prop'

// materials — tuned PBR presets, toon shading
export { createStandardMaterial, createToonMaterial, createGradientRamp, MATERIAL_PRESETS } from './materials'
export type { MaterialPreset, MaterialPresetParams, ToonMaterialOptions } from './materials'

// textures — seeded, procedural, headless-safe
export { createGridTexture, createNoiseTexture, createGradientTexture } from './textures'
export type { GridTextureOptions, NoiseTextureOptions, GradientTextureOptions } from './textures'

// props — a starter catalogue built on Prop
export { crystalProp, rockProp, treeProp, lampPostProp } from './props'
export type { PropOptions, CrystalOptions, RockOptions, TreeOptions, LampPostOptions } from './props'
