import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { disposeMaterial } from 'Δ/lifecycle/dispose'

import {
  ASSET_MANIFEST,
  CREATE_PROP_SCHEMA,
  MATERIAL_PRESET_NAMES,
  PROP_PRESET_NAMES,
  TEXTURE_PRESET_NAMES,
  Prop,
  applyBend,
  applyTaper,
  applyTwist,
  createConnectionGraph,
  createExtrudedMesh,
  createGroup,
  createHolographicMaterial,
  createInfiniteGround,
  createInstancedProp,
  createLatheMesh,
  createMaterialPreset,
  createMatcapMaterial,
  createMatcapTexture,
  createPathTube,
  createProp,
  createPropComposite,
  createPropRegistry,
  createPropTool,
  createRockGeometry,
  createSeamlessNoiseTexture,
  createTexturePreset,
  createTriplanarMaterial,
  defineProp,
  displaceByNoise,
  edgeSplit,
  extrudeAlongPath,
  gearShape,
  groupBounds,
  layoutGrid,
  layoutRadial,
  layoutStack,
  mergeGeometryList,
  mergeMeshes,
  mergeVertices,
  parallelTransportFrames,
  polygonShape,
  recomputeNormals,
  ringShape,
  roundedRectShape,
  simplifyGeometry,
  starShape,
  tessellateGeometry,
  tryCreateProp,
} from 'ꭍ/assets'

import type { PropDefinition } from 'ꭍ/assets'


function disposeMesh (mesh: THREE.Mesh): void {
  mesh.geometry.dispose()

  const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
  for (const material of materials)
    disposeMaterial(material)
}

function oneMeshDefinition (name = 'test-cube'): PropDefinition {
  return defineProp({
    name,
    description: 'test cube',
    tags:        [ 'test' ],
    parameters:  {
      size: { kind: 'number', default: 1, min: 0.1, max: 2 },
    },
    build: options => new Prop(name).addPart('body', new THREE.Mesh(
      new THREE.BoxGeometry(options.size as number, 1, 1),
      new THREE.MeshBasicMaterial(),
    )),
  })
}

describe('ported geometry profiles and sweeps', () => {
  it('builds every shape profile, including clamped degenerate inputs', () => {
    const shapes = [
      roundedRectShape(-2, 1, 99),
      polygonShape(0, -1),
      starShape(0, 1, 0.4),
      gearShape(0, 1, 0.25),
      ringShape(1, 2),
    ]
    for (const shape of shapes)
      expect(shape.getPoints().length).toBeGreaterThan(2)
  })

  it('extrudes raw points and shapes along a path', () => {
    const material = new THREE.MeshBasicMaterial()
    const mesh     = createExtrudedMesh({
      points: [[ -1, -1 ], [ 1, -1 ], [ 0, 1 ]],
      depth:  0.4,
      material,
    })
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    mesh.geometry.dispose()

    const pathMesh = extrudeAlongPath(
      roundedRectShape(0.2, 0.1, 0.02),
      new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 2)),
      { steps: 4, material },
    )
    expect(pathMesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    pathMesh.geometry.dispose()
    material.dispose()
    expect(() => createExtrudedMesh({ points: [[ 0, 0 ], [ 1, 1 ]]})).toThrow(/at least 3/)
  })

  it('lathes a profile and rejects an unusable one', () => {
    const mesh = createLatheMesh([[ 0.2, 0 ], [ 0.5, 0.5 ], [ 0.1, 1 ]], { segments: 8 })
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    disposeMesh(mesh)
    expect(() => createLatheMesh([[ 0.2, 0 ]])).toThrow(/at least 2/)
  })

  it('builds stable transport frames and variable-radius path tubes', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.5, 1, 0),
    ]
    const frames = parallelTransportFrames(points)
    expect(frames.normals).toHaveLength(points.length)
    expect(frames.normals.every(normal => Number.isFinite(normal.x))).toBe(true)

    const tube = createPathTube(points, { radialSegments: 2, radius: t => 0.1 + t * 0.1 })
    expect(tube.index?.count).toBeGreaterThan(0)
    tube.dispose()
    expect(() => createPathTube([ new THREE.Vector3() ])).toThrow(/at least 2/)
  })
})

describe('ported geometry modifiers and organization', () => {
  it('runs every deformation and utility wrapper', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)
    expect(applyTwist(geometry, 0.4)).toBe(geometry)
    expect(applyTaper(geometry, 0.7)).toBe(geometry)
    expect(applyBend(geometry, 0.25)).toBe(geometry)
    expect(displaceByNoise(geometry, { seed: 7, amp: 0.04 })).toBe(geometry)
    expect(recomputeNormals(geometry)).toBe(geometry)

    const simplified  = simplifyGeometry(geometry, 2)
    const tessellated = tessellateGeometry(geometry, 0.4, 1)
    const split       = edgeSplit(geometry, Math.PI / 4)
    const welded      = mergeVertices(geometry)
    for (const result of [ simplified, tessellated, split, welded ]) {
      expect(result.getAttribute('position')).toBeDefined()
      result.dispose()
    }
    geometry.dispose()
  })

  it('handles empty geometry wrappers without addon crashes', () => {
    const empty = new THREE.BufferGeometry()
    expect(applyTwist(empty, 1)).toBe(empty)
    for (const result of [ simplifyGeometry(empty, 10), tessellateGeometry(empty), edgeSplit(empty), mergeVertices(empty) ]) {
      expect(result).toBeInstanceOf(THREE.BufferGeometry)
      result.dispose()
    }
    empty.dispose()
  })

  it('merges meshes by material and raw geometry lists', () => {
    const material = new THREE.MeshBasicMaterial()
    const a        = new THREE.Mesh(new THREE.BoxGeometry(), material)
    const b        = new THREE.Mesh(new THREE.BoxGeometry(), material)
    b.position.x   = 2

    const merged   = mergeMeshes([ a, b ]) as THREE.Mesh
    expect(merged).toBeInstanceOf(THREE.Mesh)
    expect(groupBounds(merged).max.x).toBeGreaterThan(2)
    merged.geometry.dispose()
    a.geometry.dispose()
    b.geometry.dispose()
    material.dispose()

    const raw = mergeGeometryList([ new THREE.BoxGeometry(), new THREE.BoxGeometry() ])
    expect(raw.getAttribute('position').count).toBeGreaterThan(0)
    raw.dispose()
    expect(mergeMeshes([])).toBeInstanceOf(THREE.Group)
    expect(mergeGeometryList([]).getAttribute('position')).toBeUndefined()
  })

  it('groups and lays out empty or populated object lists', () => {
    const objects = Array.from({ length: 5 }, () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    expect(createGroup(objects).children).toHaveLength(5)
    expect(layoutGrid(objects, { cols: 0 })).toBe(objects)
    expect(layoutRadial(objects, { radius: 3 })).toBe(objects)
    expect(layoutStack(objects, 'y', 0.5)).toBe(objects)
    expect(groupBounds(createGroup(objects)).isEmpty()).toBe(false)
    expect(layoutGrid([])).toEqual([])
    expect(layoutRadial([])).toEqual([])
    for (const object of objects)
      disposeMesh(object)
  })

  it('builds and disposes connection graphs and infinite ground', () => {
    const graph = createConnectionGraph([[ 0, 0, 0 ], [ 1, 0, 0 ], [ 0, 1, 0 ]], { neighbors: 2 })
    expect(graph.edges.length).toBeGreaterThan(0)
    graph.setProgress(2)
    graph.setHighlight(1)
    graph.dispose()

    const ground = createInfiniteGround({ tileSize: 2, gridRadius: 0, segments: 2, displace: (x, z) => x + z })
    expect(ground.object.children).toHaveLength(1)
    expect(ground.heightAt(2, 3)).toBe(5)
    ground.update(new THREE.Vector3(20, 0, 20))
    ground.dispose()
  })

  it('creates rounded seeded rocks instead of tetrahedra', () => {
    const a      = createRockGeometry({ seed: 4, detail: 1 })
    const b      = createRockGeometry({ seed: 4, detail: 1 })
    const c      = createRockGeometry({ seed: 5, detail: 1 })
    const values = (geometry: THREE.BufferGeometry): number[] =>
      Array.from((geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>)
    expect(values(a)).toEqual(values(b))
    expect(values(a)).not.toEqual(values(c))
    expect((a.getAttribute('position') as THREE.BufferAttribute).count).toBeGreaterThan(12)
    a.dispose()
    b.dispose()
    c.dispose()
  })
})

describe('ported textures and materials', () => {
  it('makes deterministic seamless noise with matching edges', () => {
    const a = createSeamlessNoiseTexture({ size: 16, seed: 9 })
    const b = createSeamlessNoiseTexture({ size: 16, seed: 9 })
    expect(Array.from(a.image.data!)).toEqual(Array.from(b.image.data!))

    const data = a.image.data as Uint8Array
    for (let y = 0; y < 16; y++)
      expect(data[y * 16 * 4]).toBe(data[(y * 16 + 15) * 4])
    a.dispose()
    b.dispose()
  })

  it('creates procedural matcap, matcap material, hologram, and triplanar material', () => {
    const texture   = createMatcapTexture({ size: 16 })
    const matcap    = createMatcapMaterial(texture)
    const hologram  = createHolographicMaterial()
    const triplanar = createTriplanarMaterial()
    hologram.userData.tick({ delta: 1 / 60, elapsed: 2, frame: 120 })
    expect(hologram.uniforms.uTime?.value).toBe(2)
    expect(matcap.matcap).toBe(texture)
    expect(triplanar).toBeInstanceOf(THREE.ShaderMaterial)
    matcap.dispose()
    texture.dispose()
    hologram.dispose()
    triplanar.dispose()
  })
})

describe('llm-first prop interface and ownership', () => {
  it('resolves exact presets before prose and clamps malformed options', () => {
    const crystal = createProp('crystal', { scale: 999, glow: -50, ignored: true })
    expect(crystal.scale.x).toBe(20)

    const crate = createProp({ preset: 'crate', options: { scale: 'huge', ignored: 1 }})
    expect(crate.scale.x).toBe(1)
    crystal.dispose()
    crate.dispose()
  })

  it('accepts raw specs and model prose, while never-throw forms report failure', () => {
    const prose = createProp('sure! ```json\n{"name":"block","parts":[{"shape":"box","size":[1,1,1],"at":[0,0.5,0]}]}\n```')
    expect(prose.name).toBe('block')
    prose.dispose()
    expect(() => createProp('absolutely not json')).toThrow(/unusable input/)
    expect(tryCreateProp('absolutely not json').ok).toBe(false)
    expect(createPropTool().run('crate').prop?.name).toBe('crate')
  })

  it('supports direct definitions and explicit owned registries', () => {
    const definition = oneMeshDefinition('registered-cube')
    const direct     = createProp(definition, { size: 99 })
    const registry   = createPropRegistry([])
    registry.register(definition)

    const registered = registry.create('registered-cube', { size: 0 })
    expect(groupBounds(direct).max.x - groupBounds(direct).min.x).toBeCloseTo(2)
    expect(groupBounds(registered).max.x - groupBounds(registered).min.x).toBeCloseTo(0.1)
    direct.dispose()
    registered.dispose()
  })

  it('disposes every child prop in a composite exactly once', () => {
    const a         = createProp(oneMeshDefinition('composite-a'))
    const b         = createProp(oneMeshDefinition('composite-b'))
    const disposeA  = vi.spyOn(a, 'dispose')
    const disposeB  = vi.spyOn(b, 'dispose')
    const composite = createPropComposite([
      { prop: a, position: [ 1, 0, 0 ]},
      { prop: b, scale: 2 },
    ])
    composite.dispose()
    composite.dispose()
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).toHaveBeenCalledTimes(1)
  })

  it('instances one mesh per part and leaves source teardown to one owner', () => {
    let geometry: THREE.BufferGeometry | undefined
    let material: THREE.Material | undefined
    const definition = defineProp({
      name:        'multipart',
      description: 'two-part test prop',
      tags:        [ 'test' ],
      parameters:  {},
      build () {
        geometry = new THREE.BoxGeometry()
        material = new THREE.MeshBasicMaterial()
        return new Prop('multipart')
          .addPart('a', new THREE.Mesh(geometry, material))
          .addPart('b', new THREE.Mesh(new THREE.SphereGeometry(), material))
      },
    })
    const result          = createInstancedProp(definition, { count: 8, seed: 2 })
    const geometryDispose = vi.spyOn(geometry as THREE.BufferGeometry, 'dispose')
    const materialDispose = vi.spyOn(material as THREE.Material, 'dispose')
    expect(result.object).toBeInstanceOf(THREE.Group)
    expect(result.meshes).toHaveLength(2)
    expect(result.meshes.every(mesh => mesh.count === 8)).toBe(true)
    result.dispose()
    result.dispose()
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)

    const single = createInstancedProp(oneMeshDefinition(), { count: 3 })
    expect(single.object).toBeInstanceOf(THREE.InstancedMesh)
    expect(single.meshes).toHaveLength(1)
    single.dispose()
  })
})

describe('asset manifest', () => {
  it('matches every executable registry and contains no functions', () => {
    expect(ASSET_MANIFEST.textures.map(entry => entry.name)).toEqual(TEXTURE_PRESET_NAMES)
    expect(ASSET_MANIFEST.materials.map(entry => entry.name)).toEqual(MATERIAL_PRESET_NAMES)
    expect(ASSET_MANIFEST.props.map(entry => entry.name)).toEqual(PROP_PRESET_NAMES)
    expect(ASSET_MANIFEST.textures).toHaveLength(5)
    expect(ASSET_MANIFEST.materials).toHaveLength(12)
    expect(ASSET_MANIFEST.props).toHaveLength(22)
    expect(CREATE_PROP_SCHEMA.oneOf).toHaveLength(3)

    const visit = (value: unknown): void => {
      expect(typeof value).not.toBe('function')
      if (Array.isArray(value))
        value.forEach(visit)
      else if (value && typeof value === 'object')
        Object.values(value).forEach(visit)
    }
    visit(ASSET_MANIFEST)
    expect(() => JSON.parse(JSON.stringify(ASSET_MANIFEST))).not.toThrow()
  })

  it('constructs and disposes every manifest entry', () => {
    for (const name of TEXTURE_PRESET_NAMES)
      createTexturePreset(name, { size: 8 }).dispose()
    for (const name of MATERIAL_PRESET_NAMES)
      disposeMaterial(createMaterialPreset(name, { size: 8 }))
    for (const name of PROP_PRESET_NAMES)
      createProp(name).dispose()
  })
})
