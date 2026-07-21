// modules/post/index.ts
// The post-processing composition layer + the standalone custom-GLSL passes.
// EffectComposer factory (composer.ts) and a reorderable named-pass pipeline
// (pipeline.ts), plus the top-level passes: grade, glitch, god-rays,
// dof+chromatic, film-grain, hud-beam, stereoscopy, cinematic-lut.
//
// The full WebGL effect catalogue (bloom, ca, crt, pixel, …) mirrors the
// source's own layout and lives one level down — import it from
// `@tuomashatakka/threejs-scene/modules/post/webgl` (barrel: ./webgl/index).
//
// Ported (WebGL only) from threejs-scenes/lib/post. WebGPU/TSL is out of scope.
export * from './composer.js';
export * from './pipeline.js';
export * from './grade-pass.js';
export * from './glitch-passes.js';
export * from './god-rays-pass.js';
export * from './dof-chromatic-pass.js';
export * from './film-grain-pass.js';
export * from './hud-beam-transition.js';
export * from './stereoscopy.js';
export * from './cinematic-lut.js';
