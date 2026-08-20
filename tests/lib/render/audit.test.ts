import { describe, expect, it } from 'vitest'

import { packedRows, readVaryings } from 'Δ/index'


/**
 * The census exists to settle an argument a blank screen cannot,
 * so it has to be right about the thing that makes it hard: a varying
 * declared inside a branch the shader never takes is not a varying the driver
 * ever sees. `flatShading` is exactly that case — three wraps `vNormal` in
 * `#ifndef FLAT_SHADED`, and counting declarations flat claims three
 * components the program does not spend.
 */
describe('readVaryings', () => {
  it('skips a declaration the preprocessor never reaches', () => {
    const source = [
      '#define FLAT_SHADED',
      'varying vec3 vViewPosition;',
      '#ifndef FLAT_SHADED',
      'varying vec3 vNormal;',
      '#endif',
    ].join('\n')

    expect(readVaryings(source).map(v => v.name)).toEqual([ 'vViewPosition' ])
  })

  it('keeps a declaration whose guard is satisfied', () => {
    const source = [
      'varying vec3 vViewPosition;',
      '#ifndef FLAT_SHADED',
      'varying vec3 vNormal;',
      '#endif',
    ].join('\n')

    expect(readVaryings(source).map(v => v.name)).toEqual([ 'vViewPosition', 'vNormal' ])
  })

  it('resolves an array length through the define that sets it', () => {
    const source = [
      '#define NUM_DIR_LIGHT_SHADOWS 2',
      '#if NUM_DIR_LIGHT_SHADOWS > 0',
      'varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];',
      '#endif',
    ].join('\n')

    expect(readVaryings(source)).toEqual([
      { name: 'vDirectionalShadowCoord', type: 'vec4', size: 2 },
    ])
  })

  it('drops an array whose count is zero', () => {
    const source = [
      '#if NUM_POINT_LIGHT_SHADOWS > 0',
      'varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];',
      '#endif',
    ].join('\n')

    expect(readVaryings(source)).toEqual([])
  })

  // The first cut of this parser computed branch liveness including the level
  // being opened, so `#else` after a false `#if` came out false as well and the
  // census silently under-counted. `vColor` is a live example: three declares it
  // through exactly this shape.
  it('takes the else branch when the if was not taken', () => {
    const source = [
      '#if defined( USE_COLOR_ALPHA )',
      'varying vec4 vColor;',
      '#else',
      'varying vec3 vColor;',
      '#endif',
    ].join('\n')

    expect(readVaryings(source)).toEqual([{ name: 'vColor', type: 'vec3', size: 1 }])
  })

  it('takes only the first true arm of an if/elif/else', () => {
    const source = [
      '#define USE_COLOR 1',
      '#if defined( USE_COLOR_ALPHA )',
      'varying vec4 vAlpha;',
      '#elif defined( USE_COLOR )',
      'varying vec3 vColor;',
      '#else',
      'varying vec2 vNeither;',
      '#endif',
    ].join('\n')

    expect(readVaryings(source).map(v => v.name)).toEqual([ 'vColor' ])
  })

  it('keeps a dead outer branch dead however its inner arms read', () => {
    const source = [
      '#ifdef NEVER_DEFINED',
      '#ifdef ALSO_NOT',
      'varying vec3 vA;',
      '#else',
      'varying vec3 vB;',
      '#endif',
      '#endif',
      'varying vec2 vReal;',
    ].join('\n')

    expect(readVaryings(source).map(v => v.name)).toEqual([ 'vReal' ])
  })

  it('ignores fragment outputs and built-ins', () => {
    const source = [
      'layout(location = 0) out vec4 pc_fragColor;',
      'out vec4 gl_Position;',
      'varying vec2 vGround;',
    ].join('\n')

    expect(readVaryings(source).map(v => v.name)).toEqual([ 'vGround' ])
  })

  it('reads a precision-qualified declaration', () => {
    expect(readVaryings('varying highp vec2 vGround;')).toEqual([
      { name: 'vGround', type: 'vec2', size: 1 },
    ])
  })

  /**
   * A realistic program, as three actually assembles one: flat-shaded,
   * vertex-coloured, fogged, one directional shadow, plus two the app injects
   * itself. Fifteen components — and a mobile driver reporting sixty means this
   * is a quarter of the budget, which is the kind of answer the census exists to
   * give when a driver refuses a program and logs nothing about why.
   */
  it('counts a lit, fogged, vertex-coloured program at fifteen components', () => {
    const source = [
      '#define FLAT_SHADED',
      '#define USE_COLOR',
      '#define USE_FOG',
      '#define NUM_DIR_LIGHT_SHADOWS 1',
      'varying vec3 vViewPosition;',
      '#ifndef FLAT_SHADED',
      'varying vec3 vNormal;',
      '#endif',
      '#ifdef USE_COLOR',
      'varying vec4 vColor;',
      '#endif',
      '#ifdef USE_FOG',
      'varying float vFogDepth;',
      '#endif',
      '#if NUM_DIR_LIGHT_SHADOWS > 0',
      'varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];',
      '#endif',
      'varying vec2 vGround;',
      'varying float vUp;',
    ].join('\n')

    const varyings  = readVaryings(source)
    const component = { vec4: 4, vec3: 3, vec2: 2, float: 1 } as Record<string, number>
    const total     = varyings.reduce((sum, v) => sum + component[v.type]! * v.size, 0)

    expect(varyings.map(v => v.name)).not.toContain('vNormal')
    expect(total).toBe(15)
    expect(packedRows(varyings)).toBeLessThanOrEqual(15)
  })
})

describe('packedRows', () => {
  it('gives every vec4 a row of its own', () => {
    expect(packedRows([
      { name: 'a', type: 'vec4', size: 1 },
      { name: 'b', type: 'vec4', size: 1 },
    ])).toBe(2)
  })

  it('lets a float ride along in a vec3 row', () => {
    expect(packedRows([
      { name: 'a', type: 'vec3', size: 1 },
      { name: 'b', type: 'float', size: 1 },
    ])).toBe(1)
  })

  it('pairs vec2s two to a row', () => {
    expect(packedRows([
      { name: 'a', type: 'vec2', size: 1 },
      { name: 'b', type: 'vec2', size: 1 },
      { name: 'c', type: 'vec2', size: 1 },
    ])).toBe(2)
  })

  it('spends a whole row per array element', () => {
    expect(packedRows([{ name: 'a', type: 'vec4', size: 3 }])).toBe(3)
  })

  it('spends a row per matrix column', () => {
    expect(packedRows([{ name: 'a', type: 'mat4', size: 1 }])).toBe(4)
  })

  it('holds a realistic program well inside a phone budget', () => {
    // 15 rows is what the PowerVR handset reports; this must clear it easily.
    expect(packedRows([
      { name: 'vViewPosition', type: 'vec3', size: 1 },
      { name: 'vColor', type: 'vec4', size: 1 },
      { name: 'vFogDepth', type: 'float', size: 1 },
      { name: 'vDirectionalShadowCoord', type: 'vec4', size: 1 },
      { name: 'vGround', type: 'vec2', size: 1 },
      { name: 'vUp', type: 'float', size: 1 },
    ])).toBeLessThanOrEqual(5)
  })
})
