import { createSeededRng } from '../../lib/index.js'

import { defineProp } from './definition.js'
import { kitProp, KIT_PROP_NAMES } from './kit.js'
import { boatProp, cloudProp, crystalProp, lampPostProp, rockProp, treeProp } from './props.js'

import type { PropDefinition, ResolvedPropOptions } from './definition.js'
import type { ParamSpecMap } from './params.js'


const seedAndScale = {
  seed:  { kind: 'int', default: 1, min: 0, max: 2_147_483_647, description: 'deterministic variation seed' },
  scale: { kind: 'number', default: 1, min: 0.05, max: 20, description: 'uniform finished scale' },
} as const satisfies ParamSpecMap

function numberOption (options: ResolvedPropOptions, name: string): number {
  return options[name] as number
}

function stringOption (options: ResolvedPropOptions, name: string): string {
  return options[name] as string
}

const starterDefinitions: PropDefinition[] = [
  defineProp({
    name:        'crystal',
    description: 'faceted glass crystal with a luminous core',
    tags:        [ 'fantasy', 'pickup', 'glowing' ],
    parameters:  {
      ...seedAndScale,
      color: { kind: 'string', default: '#79f7ff', description: 'shell and glow color' },
      glow:  { kind: 'number', default: 2.5, min: 0, max: 20, description: 'emissive intensity' },
    },
    build: options => crystalProp({
      rng:   createSeededRng(numberOption(options, 'seed')),
      scale: numberOption(options, 'scale'),
      color: stringOption(options, 'color'),
      glow:  numberOption(options, 'glow'),
    }),
  }),
  defineProp({
    name:        'rock',
    description: 'rounded, watertight low-poly boulder',
    tags:        [ 'nature', 'stone', 'physics' ],
    parameters:  {
      ...seedAndScale,
      color: { kind: 'string', default: '#7c776e', description: 'stone color' },
    },
    build: options => rockProp({
      rng:   createSeededRng(numberOption(options, 'seed')),
      scale: numberOption(options, 'scale'),
      color: stringOption(options, 'color'),
    }),
  }),
  defineProp({
    name:        'tree',
    description: 'stylized conifer with a tapered trunk and layered canopy',
    tags:        [ 'nature', 'foliage', 'outdoor' ],
    parameters:  {
      ...seedAndScale,
      trunkColor:  { kind: 'string', default: '#4a3728', description: 'trunk color' },
      canopyColor: { kind: 'string', default: '#3f7d52', description: 'canopy color' },
    },
    build: options => treeProp({
      rng:         createSeededRng(numberOption(options, 'seed')),
      scale:       numberOption(options, 'scale'),
      trunkColor:  stringOption(options, 'trunkColor'),
      canopyColor: stringOption(options, 'canopyColor'),
    }),
  }),
  defineProp({
    name:        'boat',
    description: 'small low-poly sailing dinghy with mast and triangular sail',
    tags:        [ 'vehicle', 'water', 'nautical' ],
    parameters:  {
      ...seedAndScale,
      hullColor: { kind: 'string', default: '#8a4436', description: 'hull color' },
      sailColor: { kind: 'string', default: '#ece7d9', description: 'sail color' },
    },
    build: options => boatProp({
      rng:       createSeededRng(numberOption(options, 'seed')),
      scale:     numberOption(options, 'scale'),
      hullColor: stringOption(options, 'hullColor'),
      sailColor: stringOption(options, 'sailColor'),
    }),
  }),
  defineProp({
    name:        'cloud',
    description: 'faceted cluster of soft low-poly cloud puffs',
    tags:        [ 'weather', 'sky', 'nature' ],
    parameters:  {
      ...seedAndScale,
      color: { kind: 'string', default: '#eef1f6', description: 'cloud color' },
    },
    build: options => cloudProp({
      rng:   createSeededRng(numberOption(options, 'seed')),
      scale: numberOption(options, 'scale'),
      color: stringOption(options, 'color'),
    }),
  }),
  defineProp({
    name:        'lamp-post',
    description: 'metal lamp post with an emissive bulb and optional real light',
    tags:        [ 'urban', 'light', 'emissive' ],
    parameters:  {
      ...seedAndScale,
      lightColor: { kind: 'string', default: '#ffd9a0', description: 'bulb and light color' },
      withLight:  { kind: 'boolean', default: false, description: 'attach a PointLight' },
    },
    build: options => lampPostProp({
      scale:      numberOption(options, 'scale'),
      lightColor: stringOption(options, 'lightColor'),
      withLight:  options.withLight as boolean,
    }),
  }),
]

const kitDescriptions: Record<(typeof KIT_PROP_NAMES)[number], string> = {
  'ruined-block':      'half-standing concrete shell with exposed rubble and rebar',
  'crumbled-building': 'two-storey ruined building with a missing corner',
  'container':         'corrugated shipping container',
  'crate-stack':       'pallet of stacked and scattered timber crates',
  'watchtower':        'timber watchtower with railings and a tin roof',
  'pylon':             'tapered utility pylon with crossarms and insulators',
  'wreck-car':         'burnt-out low-poly car wreck',
  'dead-tree':         'leaning dead conifer with broken limbs',
  'barrel-cluster':    'three weathered oil drums, one tipped over',
  'rubble-pile':       'rounded concrete rubble with exposed rebar',
  'barricade':         'sandbags and corrugated steel barricade',
  'tire-stack':        'four worn tires in an uneven stack',
  'road-sign':         'leaning, weathered highway sign',
  'crag':              'large rounded rock formation for terrain silhouettes',
  'barrel':            'single physics-ready oil drum',
  'crate':             'single physics-ready timber crate',
}

const kitDefinitions = KIT_PROP_NAMES.map(name => defineProp({
  name,
  description: kitDescriptions[name],
  tags:        [ 'wasteland', name === 'crag' || name === 'rubble-pile' ? 'rock' : 'prop', name === 'barrel' || name === 'crate' ? 'physics' : 'set-dressing' ],
  parameters:  seedAndScale,
  build (options) {
    const prop = kitProp(name, { rng: createSeededRng(numberOption(options, 'seed')) })
    prop.scale.setScalar(numberOption(options, 'scale'))
    return prop
  },
}))

/** Every executable built-in prop definition, in stable gallery order. */
export const PROP_DEFINITIONS: readonly PropDefinition[] = Object.freeze([
  ...starterDefinitions,
  ...kitDefinitions,
])

/** Every built-in preset name; exactly mirrors {@link PROP_DEFINITIONS}. */
export const PROP_PRESET_NAMES: readonly string[] = Object.freeze(PROP_DEFINITIONS.map(definition => definition.name))
