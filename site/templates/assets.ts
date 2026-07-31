// Asset gallery — the manifest is the scene plan
// -----------------------------------------------
// No preset name is duplicated here. ASSET_MANIFEST is both llm documentation
// and the source of truth for this gallery; if a preset is added, it appears on
// the next build or the manifest-construction test fails first.

import * as THREE from 'three'

import { createApp, defineModule, disposeMaterial } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'
import {
  ASSET_MANIFEST,
  createGroup,
  createMaterialPreset,
  createProp,
  createTexturePreset,
  groupBounds,
  layoutGrid,
} from 'threejs-scene/modules/assets'

import type { App, AppModule, FrameContext } from 'threejs-scene'
import type { Prop } from 'threejs-scene/modules/assets'


type GalleryState = Record<string, never>

interface Label {
  text:     string
  position: readonly [number, number, number]
  width?:   number
}

type CreateLabelAtlasReturnType = { mesh: THREE.Mesh, material: THREE.Material }

function createLabelAtlas (labels: readonly Label[]): CreateLabelAtlasReturnType {
  const columns    = 8
  const cellWidth  = 256
  const cellHeight = 64
  const rows       = Math.ceil(labels.length / columns)
  const canvas     = document.createElement('canvas')
  canvas.width     = columns * cellWidth
  canvas.height    = THREE.MathUtils.ceilPowerOfTwo(rows * cellHeight)

  const context    = canvas.getContext('2d')
  if (!context)
    throw new Error('asset gallery: canvas 2d unavailable')

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font         = '600 25px ui-monospace, SFMono-Regular, Menlo, monospace'
  context.textAlign    = 'center'
  context.textBaseline = 'middle'
  context.fillStyle    = '#eef4ff'
  for (let index = 0; index < labels.length; index++) {
    const column = index % columns
    const row    = Math.floor(index / columns)
    context.fillText(labels[index]!.text, column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2, cellWidth - 16)
  }

  const positions = new Float32Array(labels.length * 4 * 3)
  const uvs       = new Float32Array(labels.length * 4 * 2)
  const indices   = new Uint32Array(labels.length * 6)
  for (let index = 0; index < labels.length; index++) {
    const label          = labels[index]!
    const width          = label.width ?? 2.2
    const depth          = 0.42
    const [ x, y, z ]    = label.position
    const positionOffset = index * 12
    positions.set([
      x - width / 2, y, z - depth / 2,
      x + width / 2, y, z - depth / 2,
      x + width / 2, y, z + depth / 2,
      x - width / 2, y, z + depth / 2,
    ], positionOffset)

    const column = index % columns
    const row    = Math.floor(index / columns)
    const u0     = column * cellWidth / canvas.width
    const u1     = (column + 1) * cellWidth / canvas.width
    const v0     = 1 - (row + 1) * cellHeight / canvas.height
    const v1     = 1 - row * cellHeight / canvas.height
    uvs.set([ u0, v0, u1, v0, u1, v1, u0, v1 ], index * 8)

    const vertex = index * 4
    indices.set([ vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2 ], index * 6)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  const texture      = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter  = THREE.LinearMipmapLinearFilter

  const material   = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, depthWrite: false, side: THREE.DoubleSide })
  const mesh       = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 10
  return { mesh, material }
}

function fitPropToCell (prop: Prop): void {
  prop.updateWorldMatrix(true, true)

  const bounds = groupBounds(prop)
  const size   = bounds.getSize(new THREE.Vector3())
  const scale  = Math.min(2.25 / Math.max(size.x, size.z, 1e-3), 2.8 / Math.max(size.y, 1e-3), 1.6)
  prop.scale.multiplyScalar(scale)
  prop.updateWorldMatrix(true, true)

  const grounded = groupBounds(prop)
  prop.position.y -= grounded.min.y
}

function assetGallery (): AppModule<GalleryState> {
  const root                                = new THREE.Group()
  const geometries                          = new Set<THREE.BufferGeometry>()
  const materials                           = new Set<THREE.Material>()
  const props: Prop[]                       = []
  const animatedMaterials: THREE.Material[] = []
  let labels: Label[] = []

  const ownMesh = (mesh: THREE.Mesh): THREE.Mesh => {
    geometries.add(mesh.geometry)

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
    for (const material of meshMaterials)
      materials.add(material)
    return mesh
  }

  return defineModule<GalleryState>({
    name: 'asset-gallery',

    build (context) {
      // textures
      const textureGeometry = new THREE.BoxGeometry(1.45, 0.18, 1.45)
      geometries.add(textureGeometry)

      const textureObjects = ASSET_MANIFEST.textures.map(entry => {
        const texture = createTexturePreset(entry.name)
        texture.repeat.set(2, 2)

        const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.05 })
        materials.add(material)

        const mesh         = new THREE.Mesh(textureGeometry, material)
        mesh.position.y    = 0.1
        mesh.receiveShadow = true
        return mesh
      })
      layoutGrid(textureObjects, { cols: ASSET_MANIFEST.textures.length, spacing: 2.65 })

      const textureGroup = createGroup(textureObjects, { position: [ 0, 0, 9.2 ]})
      root.add(textureGroup)
      labels.push({ text: `textures · ${ASSET_MANIFEST.textures.length}`, position: [ -8.2, 0.025, 10.5 ], width: 3.2 })
      textureObjects.forEach((object, index) => labels.push({
        text:     ASSET_MANIFEST.textures[index]!.name,
        position: [ object.position.x, 0.025, object.position.z + textureGroup.position.z + 1.05 ],
      }))

      // materials
      const materialGeometry = new THREE.SphereGeometry(0.72, 28, 18)
      geometries.add(materialGeometry)

      const materialObjects = ASSET_MANIFEST.materials.map(entry => {
        const material = createMaterialPreset(entry.name)
        materials.add(material)
        if (typeof material.userData.tick === 'function')
          animatedMaterials.push(material)

        const mesh         = new THREE.Mesh(materialGeometry, material)
        mesh.position.y    = 0.78
        mesh.castShadow    = true
        mesh.receiveShadow = true
        return mesh
      })
      layoutGrid(materialObjects, { cols: 6, spacing: 2.65 })

      const materialGroup = createGroup(materialObjects, { position: [ 0, 0, 4.6 ]})
      root.add(materialGroup)
      labels.push({ text: `materials · ${ASSET_MANIFEST.materials.length}`, position: [ -8.2, 0.025, 6.7 ], width: 3.5 })
      materialObjects.forEach((object, index) => labels.push({
        text:     ASSET_MANIFEST.materials[index]!.name,
        position: [ object.position.x, 0.025, object.position.z + materialGroup.position.z + 1.18 ],
      }))

      // props
      const propObjects = ASSET_MANIFEST.props.map(entry => {
        const prop = createProp(entry.name)
        fitPropToCell(prop)
        props.push(prop)
        return prop
      })
      layoutGrid(propObjects, { cols: 6, spacing: 3.25 })

      const propGroup = createGroup(propObjects, { position: [ 0, 0, -3.2 ]})
      root.add(propGroup)
      labels.push({ text: `props · ${ASSET_MANIFEST.props.length}`, position: [ -9.2, 0.025, 2.4 ], width: 3 })
      propObjects.forEach((object, index) => labels.push({
        text:     ASSET_MANIFEST.props[index]!.name,
        position: [ object.position.x, 0.025, object.position.z + propGroup.position.z + 1.38 ],
        width:    2.55,
      }))

      const atlas = createLabelAtlas(labels)
      geometries.add(atlas.mesh.geometry)
      materials.add(atlas.material)
      root.add(atlas.mesh)

      const floor = ownMesh(new THREE.Mesh(
        new THREE.PlaneGeometry(32, 28),
        new THREE.MeshStandardMaterial({ color: '#151a21', roughness: 0.94, metalness: 0.05 }),
      ))
      floor.rotation.x    = -Math.PI / 2
      floor.position.z    = 0.2
      floor.position.y    = -0.02
      floor.receiveShadow = true
      root.add(floor)

      context.scene.add(root)
    },

    update (_state, frame: FrameContext) {
      for (const material of animatedMaterials) {
        const tick = material.userData.tick
        if (typeof tick === 'function')
          tick(frame)
      }
    },

    dispose () {
      for (const prop of props)
        prop.dispose()
      root.removeFromParent()
      root.clear()
      for (const geometry of geometries)
        geometry.dispose()
      for (const material of materials)
        disposeMaterial(material)
      geometries.clear()
      materials.clear()
      props.length             = 0
      animatedMaterials.length = 0
      labels = []
    },
  })
}

export function mount (canvas: HTMLCanvasElement): App<GalleryState> {
  return createApp<GalleryState>(canvas, {
    state:  {},
    seed:   404,
    camera: {
      position: [ 15.5, 14, 23 ],
      lookAt:   [ 0, 0.9, 0 ],
      fov:      43,
      far:      100,
    },
    scene:    { background: '#0d1118' },
    renderer: { antialias: true, shadows: true },
    use:      [
      standardLighting({
        env:  { intensity: 0.35 },
        sun:  { position: [ 9, 16, 8 ], intensity: 2.4, shadowFrustum: 18, shadowMapSize: 2048, shadowFar: 55 },
        hemi: { skyColor: '#b9d5ff', groundColor: '#2c2118', intensity: 0.65 },
      }),
      orbitControls({ target: [ 0, 0.9, 0 ], radius: [ 8, 42 ], maxPhi: 1.45 }),
      assetGallery(),
    ],
  })
}

// perf: 22 prop draw sets plus 12 material samples, 5 texture samples, and one
// atlas label draw. Everything is built once and disposed by the gallery module.
