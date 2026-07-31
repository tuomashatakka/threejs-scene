// modules/physics/index.ts
// Physics as an optional layer: rigid bodies, cloth, and liquid, all stepped by
// one deterministic fixed-step world.
//
// Backed by cannon-es — the physics engine from three's own libraries list that
// is pure ESM with no wasm and no async init, so it runs the same in a headless
// test as in the browser. It is an OPTIONAL peer dependency: this is the only
// module that imports it, so nothing else in the package pays for it.
//
//   npm i cannon-es
//
//   import { physicsWorld, createCloth, createLiquid } from 'threejs-scene/modules/physics'
//
//   const physics = physicsWorld()
//   const app = createApp(canvas, { use: [ physics ] })
//   addGroundPlane(physics)
//   physics.add(crate, { mass: 8 })

// the world — an AppModule that owns the fixed step and the body/object sync
export { physicsWorld, addGroundPlane, addStaticBox } from './world.js'
export type { BodyOptions, BodyShape, PhysicsApi, PhysicsHandle, PhysicsWorldOptions, StepCallback } from './world.js'

// cloth — particles + distance constraints, two-way coupled to the rigid bodies
export { createCloth } from './cloth.js'
export type { Cloth, ClothOptions, ClothPinning } from './cloth.js'

// liquid — spatial-hashed position-based fluid, surfaced with marching cubes
export { createLiquid } from './liquid.js'
export type { Liquid, LiquidOptions, LiquidRenderMode, LiquidSolver } from './liquid.js'
