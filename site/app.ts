/// <reference types="vite/client" />
// site/app.ts
// The unified interactive page — playground + post-processing demo in one, built
// entirely on the real library (imported from the built package). createApp wires
// lighting + orbit + the shared scene + postProcessing(); the control panel drives
// effect toggles/params and the speed slider drives app state. This is both the
// `bun run dev` playground and the deployed demo.

import { createApp } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'
import { postProcessing } from 'threejs-scene/modules/post'

import { attachCollapse } from './collapse'
import { demoScene } from './scene'
import { buildRegistry, registryPasses, driveFrame, driveResize, createEffectsPanel } from './effects'

import type { SceneState } from './scene'
import type { Effect } from './effects'


const canvas = document.querySelector('canvas')
if (!canvas)
  throw new Error('site: canvas missing')

let registry: Effect[] = []

// bloom lives in the registry (so it's tunable/toggleable), so the composer's
// built-in bloom is off; depth is on for DOF / god rays / motion blur.
const post = postProcessing<SceneState>({
  bloom:   false,
  depth:   true,
  effects: ctx => {
    registry = buildRegistry(ctx); return registryPasses(registry)
  },
  onFrame:  frame => driveFrame(registry, frame),
  onResize: size => driveResize(registry, size),
})

const app = createApp<SceneState>(canvas, {
  state:  { speed: 1 },
  seed:   7,
  camera: { position: [ 0, 3, 9 ]},
  use:    [ standardLighting(), orbitControls({ radius: [ 3, 30 ]}), demoScene(), post ],
})

app.start()

// registry is populated during createApp (post.build ran synchronously) — now
// render the controls over it.
const list = document.querySelector<HTMLElement>('[data-fx-list]')
if (list)
  createEffectsPanel(registry, list)

// input -> setState -> next tick projects it. never straight into the scene.
const slider = document.querySelector<HTMLInputElement>('#speed')
const label  = document.querySelector<HTMLOutputElement>('#speed-out')
slider?.addEventListener('input', () => {
  app.setState({ speed: Number(slider.value) })
  if (label)
    label.textContent = Number(slider.value).toFixed(1)
})

// The panel is a convenience, not a requirement — the scene is the page.
const controls       = document.querySelector<HTMLElement>('[data-controls]')
const controlsToggle = document.querySelector<HTMLButtonElement>('[data-controls] [data-collapse]')
const detachCollapse = controls && controlsToggle
  ? attachCollapse({
    panel:      controls,
    button:     controlsToggle,
    storageKey: 'threejs-scene:controls-collapsed',
    labels:     { open: 'Hide controls', closed: 'Show controls' },
  })
  : null

// HMR: full teardown through the dispose chain
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    detachCollapse?.()
    app.dispose()
  })
