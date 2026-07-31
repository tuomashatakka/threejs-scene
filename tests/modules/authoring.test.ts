import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  PROP_EXAMPLES,
  PROP_SPEC_GRAMMAR,
  PROP_SPEC_SCHEMA,
  SHAPE_NAMES,
  SPEC_LIMITS,
  SURFACE_NAMES,
  buildProp,
  buildShape,
  createPropTool,
  extractJson,
  generateProp,
  propAuthoringPrompt,
  propRetryPrompt,
  resolvePlacements,
  reviewProp,
  tryBuildProp,
  validatePropSpec,
} from 'ꭍ/authoring'

import type { NormalizedPart, PropSpec, ShapeName } from 'ꭍ/authoring'


function normalizedPart (overrides: Partial<NormalizedPart> = {}): NormalizedPart {
  return {
    name:      'part',
    shape:     'box',
    size:      [ 1, 1, 1 ],
    at:        [ 0, 0, 0 ],
    rotate:    [ 0, 0, 0 ],
    color:     '#ffffff',
    material:  'matte',
    glow:      0,
    detail:    1,
    sides:     16,
    taper:     1,
    thickness: 0.3,
    shadow:    true,
    repeat:    null,
    ...overrides,
  }
}

function boundsOf (object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(object)
    .getSize(new THREE.Vector3())
}


describe('validatePropSpec', () => {
  it('accepts a minimal spec and fills in every default', () => {
    const { ok, spec } = validatePropSpec({ parts: [{ shape: 'box' }]})

    expect(ok).toBe(true)
    expect(spec?.parts[0]).toMatchObject({
      shape:    'box',
      size:     [ 1, 1, 1 ],
      at:       [ 0, 0, 0 ],
      material: 'matte',
      name:     'box',
    })
  })

  it('errors, rather than guessing, when there are no parts', () => {
    const review = validatePropSpec({ name: 'nothing' })

    expect(review.ok).toBe(false)
    expect(review.spec).toBeNull()
    expect(review.report).toMatch(/parts/)
  })

  it('repairs the mistakes small models actually make', () => {
    const review = validatePropSpec({
      name:  'chair',
      parts: [{ type: 'cube', dimensions: [ '0.5', 0.5, 0.5 ], position: { x: 0, y: 0.25, z: 0 }, colour: 'ff0000', surface: 'wood' }],
    })

    expect(review.ok).toBe(true)
    expect(review.spec?.parts[0]).toMatchObject({
      shape:    'box',
      size:     [ 0.5, 0.5, 0.5 ],
      at:       [ 0, 0.25, 0 ],
      color:    '#ff0000',
      material: 'matte',
    })
    expect(review.issues.every(issue => issue.level === 'warning')).toBe(true)
  })

  it('guesses through a typo but refuses an unrecognisable shape', () => {
    expect(validatePropSpec({ parts: [{ shape: 'spehre' }]}).spec?.parts[0]?.shape).toBe('sphere')

    const review = validatePropSpec({ parts: [{ shape: 'triceratops' }]})
    expect(review.ok).toBe(false)
    expect(review.report).toMatch(/unknown shape/)
  })

  it('clamps sizes, offsets and copy counts into prop territory', () => {
    const review = validatePropSpec({
      parts: [
        { shape: 'box', size: [ 900, 1, 1 ], at: [ 0, 0.5, 0 ], repeat: { count: 5000, mode: 'linear', offset: [ 1, 0, 0 ]}},
      ],
    })

    expect(review.spec?.parts[0]?.size[0]).toBe(SPEC_LIMITS.maxSize)
    expect(review.spec?.parts[0]?.repeat?.count).toBe(SPEC_LIMITS.maxCopies)
    expect(review.issues.some(issue => issue.level === 'warning')).toBe(true)
  })

  it('reads a spec out of a whole model turn, fence and trailing comma included', () => {
    const turn   = 'Sure! Here is a crate:\n```json\n{ "name": "crate", "parts": [ { "shape": "box", "size": 1, "at": [0, 0.5, 0] }, ] }\n```\nHope that helps!'
    const review = validatePropSpec(turn)

    expect(review.ok).toBe(true)
    expect(review.spec?.name).toBe('crate')
    expect(extractJson('no json here')).toBeNull()
  })

  it('unwraps the wrapper objects models like to add', () => {
    expect(validatePropSpec({ spec: { parts: [{ shape: 'box' }]}}).ok).toBe(true)
    expect(validatePropSpec([{ shape: 'box' }]).ok).toBe(true)
    expect(validatePropSpec({ parts: { leg: { shape: 'cylinder' }}}).spec?.parts[0]?.name).toBe('leg')
  })

  it('keeps a real field when an alias for it is present too', () => {
    const spec = validatePropSpec({ parts: [{ shape: 'box', size: [ 2, 2, 2 ], scale: 9 }]}).spec

    expect(spec?.parts[0]?.size).toEqual([ 2, 2, 2 ])
  })

  it('makes duplicate part names unique so no part is silently dropped', () => {
    const spec = validatePropSpec({ parts: [{ shape: 'box', name: 'leg' }, { shape: 'box', name: 'leg' }]}).spec

    expect(spec?.parts.map(part => part.name)).toEqual([ 'leg', 'leg-2' ])
  })
})

describe('buildShape', () => {
  it('makes every shape exactly fill its size box', () => {
    for (const shape of SHAPE_NAMES) {
      const size: [number, number, number] = [ 0.8, 1.6, 0.4 ]
      const geometry                       = buildShape(normalizedPart({ shape, size }))
      geometry.computeBoundingBox()

      const extent = geometry.boundingBox?.getSize(new THREE.Vector3()) as THREE.Vector3

      expect(extent.x, `${shape} x`).toBeCloseTo(size[0], 4)
      expect(extent.z, `${shape} z`).toBeCloseTo(size[2], 4)
      // flat shapes have no thickness to stretch
      expect(extent.y, `${shape} y`).toBeCloseTo(shape === 'plane' || shape === 'disc' || shape === 'ring' ? 0 : size[1], 4)
      geometry.dispose()
    }
  })

  it('centres every shape on its own origin', () => {
    for (const shape of SHAPE_NAMES) {
      const geometry = buildShape(normalizedPart({ shape, size: [ 1, 2, 1 ]}))
      geometry.computeBoundingBox()

      const centre = geometry.boundingBox?.getCenter(new THREE.Vector3()) as THREE.Vector3

      expect(centre.length(), shape).toBeLessThan(1e-4)
      geometry.dispose()
    }
  })

  it('builds the same rock for the same seed and a different one otherwise', () => {
    const first  = buildShape(normalizedPart({ shape: 'rock' }), 7)
    const same   = buildShape(normalizedPart({ shape: 'rock' }), 7)
    const other  = buildShape(normalizedPart({ shape: 'rock' }), 8)
    const values = (geometry: THREE.BufferGeometry): number[] => [ ...(geometry.attributes.position as THREE.BufferAttribute).array ]

    expect(values(first)).toEqual(values(same))
    expect(values(first)).not.toEqual(values(other))
    for (const geometry of [ first, same, other ])
      geometry.dispose()
  })
})

describe('resolvePlacements', () => {
  it('places one copy for a part with no repeat', () => {
    const placements = resolvePlacements(normalizedPart({ at: [ 1, 2, 3 ]}))

    expect(placements).toHaveLength(1)
    expect(placements[0]?.position).toEqual([ 1, 2, 3 ])
    expect(placements[0]?.name).toBe('part')
  })

  it('steps linear copies by the offset', () => {
    const placements = resolvePlacements(normalizedPart({
      name:   'post',
      at:     [ 0, 0.5, 0 ],
      repeat: { count: 3, mode: 'linear', offset: [ 1, 0, 0 ], radius: 1, arc: 360, axis: 'y', faceOut: true },
    }))

    expect(placements.map(placement => placement.position[0])).toEqual([ 0, 1, 2 ])
    expect(placements.map(placement => placement.name)).toEqual([ 'post1', 'post2', 'post3' ])
  })

  it('mirrors into 4 corners for the table-legs case', () => {
    const placements = resolvePlacements(normalizedPart({
      name:   'leg',
      at:     [ 0.2, 0.25, 0.3 ],
      repeat: { count: 4, mode: 'mirror', offset: [ 0, 0, 0 ], radius: 1, arc: 360, axis: 'x', faceOut: true },
    }))

    expect(placements).toHaveLength(4)
    expect(new Set(placements.map(placement => `${placement.position[0]},${placement.position[2]}`))).toEqual(
      new Set([ '0.2,0.3', '-0.2,0.3', '0.2,-0.3', '-0.2,-0.3' ]),
    )
    // every copy stays at the same height
    expect(placements.every(placement => placement.position[1] === 0.25)).toBe(true)
  })

  it('rings radial copies without doubling up on the seam', () => {
    const placements = resolvePlacements(normalizedPart({
      repeat: { count: 4, mode: 'radial', offset: [ 0, 0, 0 ], radius: 2, arc: 360, axis: 'y', faceOut: true },
    }))

    expect(placements).toHaveLength(4)
    for (const placement of placements)
      expect(Math.hypot(placement.position[0], placement.position[2])).toBeCloseTo(2, 6)

    // faceOut turns each copy to look along its own spoke
    const third   = placements[2] as NonNullable<(typeof placements)[number]>
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...third.rotation))
    expect(forward.x).toBeCloseTo(third.position[0] / 2, 5)
    expect(forward.z).toBeCloseTo(third.position[2] / 2, 5)
  })
})

describe('buildProp', () => {
  it('compiles a spec into named, placed meshes', () => {
    const prop = buildProp({
      name:  'bench',
      parts: [
        { name: 'top', shape: 'box', size: [ 1.2, 0.08, 0.4 ], at: [ 0, 0.44, 0 ]},
        { name: 'leg', shape: 'box', size: [ 0.08, 0.4, 0.3 ], at: [ 0.5, 0.2, 0 ], repeat: { count: 2, mode: 'mirror', axis: 'x' }},
      ],
    })

    expect(prop.name).toBe('bench')
    expect([ ...prop.parts.keys() ]).toEqual([ 'top', 'leg1', 'leg2' ])
    expect(prop.part('leg2')?.position.x).toBe(-0.5)
    expect(boundsOf(prop).x).toBeCloseTo(1.2, 4)
    prop.dispose()
  })

  it('shares one geometry and one material across repeat copies', () => {
    const prop = buildProp({
      name:  'fence',
      parts: [{ shape: 'box', size: [ 0.1, 1, 0.1 ], at: [ 0, 0.5, 0 ], repeat: { count: 6, mode: 'linear', offset: [ 0.5, 0, 0 ]}}],
    })

    const meshes = [ ...prop.parts.values() ] as THREE.Mesh[]
    expect(meshes).toHaveLength(6)
    expect(new Set(meshes.map(mesh => mesh.geometry)).size).toBe(1)
    expect(new Set(meshes.map(mesh => mesh.material)).size).toBe(1)
    prop.dispose()
  })

  it('shares one material between parts with the same finish', () => {
    const prop = buildProp({
      parts: [
        { shape: 'box', size: 1, at: [ 0, 0.5, 0 ], color: '#ff0000', material: 'metal' },
        { shape: 'box', size: 1, at: [ 1, 0.5, 0 ], color: '#ff0000', material: 'metal' },
        { shape: 'box', size: 1, at: [ 2, 0.5, 0 ], color: '#00ff00', material: 'metal' },
      ],
    })

    const materials = new Set(([ ...prop.parts.values() ] as THREE.Mesh[]).map(mesh => mesh.material))
    expect(materials.size).toBe(2)
    prop.dispose()
  })

  it('makes a glowing part emissive so a bloom pass picks it up', () => {
    const prop     = buildProp({ parts: [{ shape: 'sphere', size: 0.2, at: [ 0, 0.1, 0 ], color: '#ffcc00', glow: 3 }]})
    const material = (prop.part('sphere') as THREE.Mesh).material as THREE.MeshStandardMaterial

    expect(material.emissiveIntensity).toBe(3)
    expect(material.emissive.getHexString()).toBe('ffcc00')
    prop.dispose()
  })

  it('is deterministic — same spec, same triangles', () => {
    const spec: PropSpec = { name: 'stone', seed: 12, parts: [{ shape: 'rock', size: [ 1, 0.7, 1 ], at: [ 0, 0.35, 0 ]}]}
    const first          = buildProp(spec)
    const second         = buildProp(spec)
    const points         = (prop: ReturnType<typeof buildProp>): number[] =>
      [ ...((prop.part('rock') as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute).array ]

    expect(points(first)).toEqual(points(second))
    first.dispose()
    second.dispose()
  })

  it('throws with the report when the spec cannot be repaired', () => {
    expect(() => buildProp({ parts: []})).toThrow(/at least one part/)
  })

  it('does not throw from tryBuildProp — it reports instead', () => {
    const attempt = tryBuildProp({ parts: []})

    expect(attempt.ok).toBe(false)
    expect(attempt.prop).toBeNull()
    expect(attempt.report).toMatch(/at least one part/)
  })

  it('frees everything it built, once', () => {
    const prop     = buildProp({ parts: [{ shape: 'box', size: 1, at: [ 0, 0.5, 0 ], repeat: { count: 3, mode: 'linear', offset: [ 1, 0, 0 ]}}]})
    const mesh     = prop.part('box1') as THREE.Mesh
    const geometry = mesh.geometry
    const material = mesh.material as THREE.Material

    let geometryDisposals = 0
    let materialDisposals = 0
    geometry.addEventListener('dispose', () => {
      geometryDisposals++
    })
    material.addEventListener('dispose', () => {
      materialDisposals++
    })

    prop.dispose()
    prop.dispose()

    expect(geometryDisposals).toBe(1)
    expect(materialDisposals).toBe(1)
  })
})

describe('reviewProp', () => {
  it('measures what was built', () => {
    const review = reviewProp(buildProp({
      name:  'crate',
      parts: [{ shape: 'box', size: [ 0.8, 0.8, 0.8 ], at: [ 0, 0.4, 0 ]}],
    }))

    expect(review.meshes).toBe(1)
    expect(review.size).toEqual([ 0.8, 0.8, 0.8 ])
    expect(review.bottom).toBe(0)
    expect(review.triangles).toBe(12)
    expect(review.notes).toHaveLength(0)
    expect(review.report).toMatch(/sits on the ground/)
  })

  it('catches a prop that floats', () => {
    const review = reviewProp(buildProp({ parts: [{ shape: 'box', size: 1, at: [ 0, 3, 0 ]}]}))

    expect(review.notes.some(note => (/floats/).test(note.message))).toBe(true)
  })

  it('catches a prop that sinks into the ground', () => {
    const review = reviewProp(buildProp({ parts: [{ shape: 'box', size: 1, at: [ 0, 0, 0 ]}]}))

    expect(review.notes.some(note => (/sinks/).test(note.message))).toBe(true)
  })

  it('catches parts that never touch each other', () => {
    const review = reviewProp(buildProp({
      parts: [
        { shape: 'box', size: 0.5, at: [ 0, 0.25, 0 ]},
        { shape: 'box', size: 0.5, at: [ 5, 0.25, 0 ]},
      ],
    }))

    expect(review.notes.some(note => (/not connected/).test(note.message))).toBe(true)
  })

  it('catches a part buried inside another', () => {
    const review = reviewProp(buildProp({
      parts: [
        { name: 'shell', shape: 'box', size: 2, at: [ 0, 1, 0 ]},
        { name: 'core', shape: 'box', size: 0.2, at: [ 0, 1, 0 ]},
      ],
    }))

    expect(review.notes.some(note => note.path === 'core' && (/inside/).test(note.message))).toBe(true)
  })

  it('catches two parts stacked in the same place', () => {
    const review = reviewProp(buildProp({
      parts: [
        { name: 'a', shape: 'box', size: 1, at: [ 0, 0.5, 0 ]},
        { name: 'b', shape: 'box', size: 1, at: [ 0, 0.5, 0 ]},
      ],
    }))

    expect(review.notes.some(note => (/same place/).test(note.message))).toBe(true)
  })
})

describe('the worked examples', () => {
  it.each(PROP_EXAMPLES.map(example => [ example.brief, example.spec ] as const))('%s builds with nothing to criticise', (_brief, spec) => {
    const attempt = tryBuildProp(spec)

    expect(attempt.issues, attempt.report).toEqual([])
    expect(attempt.prop).not.toBeNull()

    const review = reviewProp(attempt.prop as NonNullable<typeof attempt.prop>)
    expect(review.notes, review.report).toEqual([])
    expect(review.triangles).toBeLessThan(20000)
    attempt.prop?.dispose()
  })
})

describe('the model-facing surface', () => {
  it('keeps the schema, the grammar and the compiler on the same vocabulary', () => {
    const shapes   = PROP_SPEC_SCHEMA.properties?.parts?.items?.properties?.shape?.enum
    const surfaces = PROP_SPEC_SCHEMA.properties?.parts?.items?.properties?.material?.enum

    expect(shapes).toEqual([ ...SHAPE_NAMES ])
    expect(surfaces).toEqual([ ...SURFACE_NAMES ])
    for (const shape of SHAPE_NAMES)
      expect(PROP_SPEC_GRAMMAR, shape).toContain(shape)
  })

  it('builds a prompt that shrinks when asked to', () => {
    const full    = propAuthoringPrompt({ examples: 3 })
    const compact = propAuthoringPrompt({ examples: 0, compact: true })

    expect(full).toContain('# a wooden chair')
    expect(compact.length).toBeLessThan(full.length)
    expect(compact).toContain('shape')
    expect(propRetryPrompt('crate: floats 1m')).toContain('crate: floats 1m')
  })

  it('reports through the tool rather than throwing', () => {
    const tool = createPropTool()

    expect(tool.name).toBe('create_prop')
    expect(tool.inputSchema.required).toEqual([ 'name', 'parts' ])

    const broken = tool.run('not json at all')
    expect(broken.ok).toBe(false)
    expect(broken.prop).toBeNull()
    expect(broken.report.length).toBeGreaterThan(0)

    const built = tool.run({ name: 'ball', parts: [{ shape: 'sphere', size: 0.5, at: [ 0, 0.25, 0 ]}]})
    expect(built.ok).toBe(true)
    expect(built.review?.meshes).toBe(1)
    built.prop?.dispose()
  })
})

describe('generateProp', () => {
  const chair = JSON.stringify(PROP_EXAMPLES[0]?.spec)

  it('takes the first answer when it is already good', async () => {
    const result = await generateProp({ brief: 'a chair', complete: () => chair })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.review?.notes).toEqual([])
    result.prop?.dispose()
  })

  it('feeds the critique back and takes the corrected answer', async () => {
    const prompts: string[] = []
    const result            = await generateProp({
      brief:    'a chair',
      attempts: 3,
      complete ({ prompt, attempt }) {
        prompts.push(prompt)
        // first turn: a chair hovering a metre above the floor
        return attempt === 1
          ? '{ "name": "chair", "parts": [ { "shape": "box", "size": 1, "at": [0, 2, 0] } ] }'
          : chair
      },
    })

    expect(result.attempts).toBe(2)
    expect(result.review?.notes).toEqual([])
    expect(prompts[0]).toContain('Build: a chair')
    expect(prompts[1]).toMatch(/floats/)
    result.prop?.dispose()
  })

  it('gives up after the attempt budget and returns its best try', async () => {
    const result = await generateProp({
      brief:    'a chair',
      attempts: 2,
      complete: () => '{ "parts": [ { "shape": "box", "size": 1, "at": [0, 9, 0] } ] }',
    })

    expect(result.attempts).toBe(2)
    expect(result.ok).toBe(true)
    expect(result.review?.notes.length).toBeGreaterThan(0)
    expect(result.transcript).toHaveLength(2)
    result.prop?.dispose()
  })

  it('never returns garbage as success', async () => {
    const result = await generateProp({ brief: 'a chair', attempts: 2, complete: () => 'I cannot do that' })

    expect(result.ok).toBe(false)
    expect(result.prop).toBeNull()
    expect(result.report).toMatch(/parts/)
  })
})

describe('shape coverage', () => {
  it('builds a prop out of every shape in the vocabulary', () => {
    const parts = SHAPE_NAMES.map((shape: ShapeName, index: number) => ({
      shape,
      size: [ 0.4, 0.4, 0.4 ] as [number, number, number],
      at:   [ index * 0.35, 0.2, 0 ] as [number, number, number],
    }))
    const prop = buildProp({ name: 'sampler', parts })

    expect(prop.parts.size).toBe(SHAPE_NAMES.length)
    expect(reviewProp(prop).triangles).toBeGreaterThan(0)
    prop.dispose()
  })
})
