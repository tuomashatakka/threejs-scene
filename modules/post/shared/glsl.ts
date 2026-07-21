// modules/post/shared/glsl.ts
// Shared GLSL chunks for the post-processing passes. Before this module the
// fullscreen-quad vertex shader was re-inlined in 16 files, the seeded `hash()`
// in 4, and the chromatic-aberration kernel in 6 — each a separate place to fix.
// Every custom-GLSL pass now composes these constants into its shader string via
// `${…}` interpolation, so the kernels live once. Samplers-as-parameters and
// `texture2D` are valid in three's ShaderMaterial GLSL on both WebGL1 and WebGL2.

// The fullscreen-quad vertex shader every ShaderPass shares.
export const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main () {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Seeded hash helpers. `hash21` for vec2 seeds (grain, jitter), `hash11` for scalars.
export const GLSL_HASH = /* glsl */`
  float hash21 (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash11 (float n) { return fract(sin(n) * 43758.5453); }
`

// Canonical chromatic aberration: the red channel samples ahead of the offset,
// blue behind, green stays centred. `off` is a uv-space displacement vector.
export const GLSL_CHROMATIC = /* glsl */`
  vec3 chromaticSample (sampler2D tex, vec2 uv, vec2 off) {
    return vec3(
      texture2D(tex, uv + off).r,
      texture2D(tex, uv).g,
      texture2D(tex, uv - off).b
    );
  }
`

// Radial vignette: 1.0 at the centre falling to `1 - amount` at the corners.
export const GLSL_VIGNETTE = /* glsl */`
  float vignette (vec2 uv, float amount) {
    return 1.0 - amount * smoothstep(0.2, 0.85, length(uv - 0.5));
  }
`

// Animated film grain: signed noise in roughly [-intensity/2, intensity/2].
export const GLSL_GRAIN = /* glsl */`
  float grain (vec2 uv, float t, float intensity) {
    return (fract(sin(dot(uv * 1024.0 + t, vec2(127.1, 311.7))) * 43758.5453) - 0.5) * intensity;
  }
`
