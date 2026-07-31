import * as THREE from 'three'

import type { Prop } from './prop.js'


export interface CompositePart {
  prop:      Prop
  position?: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  scale?:    number | readonly [number, number, number]
}

export interface PropComposite {
  readonly object: THREE.Group
  readonly parts:  readonly Prop[]
  dispose (): void
}

/** Assemble placed props under one owned group and teardown boundary. */
export function createPropComposite (parts: readonly CompositePart[]): PropComposite {
  const object = new THREE.Group()
  const props  = parts.map(part => part.prop)
  let disposed = false

  for (const part of parts) {
    if (part.position)
      part.prop.position.fromArray(part.position)
    if (part.rotation)
      part.prop.rotation.set(...part.rotation)
    if (typeof part.scale === 'number')
      part.prop.scale.setScalar(part.scale)
    else if (part.scale)
      part.prop.scale.fromArray(part.scale)
    object.add(part.prop)
  }

  return {
    object,
    parts: props,
    dispose () {
      if (disposed)
        return
      disposed = true
      for (const prop of props)
        prop.dispose()
      object.clear()
      object.removeFromParent()
    },
  }
}

// perf: a composite adds no draw calls beyond its parts.
