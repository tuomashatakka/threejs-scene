/// <reference types="vite/client" />
// site/starters.ts
// The starter gallery. Each template is imported TWICE — once as a module (to
// run it) and once through Vite's `?raw` (to show it). That is the whole point
// of the page: the source on the right is not a copy of the code on the left,
// it IS the code on the left, so the two can never drift.
//
// Only one template runs at a time. Switching disposes the previous app and
// swaps in a fresh canvas: a canvas that has already handed out a WebGL context
// cannot reliably hand out another, so reusing the element leaks or blanks.

import { mount as mountIsometric } from './templates/isometric'
import { mount as mountIsometricSqr } from './templates/isometric-sqr'
import { mount as mountHovership } from './templates/hovership'
import { mount as mountProduct } from './templates/product'

import isometricSource from './templates/isometric.ts?raw'
import isometricSqrSource from './templates/isometric-sqr.ts?raw'
import hovershipSource from './templates/hovership.ts?raw'
import productSource from './templates/product.ts?raw'

import { attachCollapse } from './collapse'

import type { App } from 'threejs-scene'


interface Starter {
  id:     string
  title:  string
  blurb:  string
  file:   string
  source: string
  mount:  (canvas: HTMLCanvasElement) => App<never>
}

// `App<S>` is invariant in S across the three templates, and the page never
// touches their state — it only starts and disposes them.
const asStarterMount = (fn: (canvas: HTMLCanvasElement) => App<never>): Starter['mount'] => fn

const STARTERS: Starter[] = [
  {
    id:     'isometric',
    title:  'Isometric endless scape',
    blurb:  'Pannable, zoomable tilt-shift over endless terrain. Zoom in and the rig tilts up as the bokeh thickens.',
    file:   'templates/isometric.ts',
    source: isometricSource,
    mount:  asStarterMount(mountIsometric as never),
  },
  {
    id:     'isometric-sqr',
    title:  'Isometric Square Scape',
    blurb:  'Pannable, zoomable tilt-shift over endless terrain. Zoom in and the rig tilts up as the bokeh thickens.',
    file:   'templates/isometric-sqr.ts',
    source: isometricSqrSource,
    mount:  asStarterMount(mountIsometricSqr as never),
  },
  {
    id:     'hovership',
    title:  'Hovership racer',
    blurb:  'Chase camera on a procedural circuit, with a cockpit view a button away. Flat out on the straights, and the focus racks with the throttle.',
    file:   'templates/hovership.ts',
    source: hovershipSource,
    mount:  asStarterMount(mountHovership as never),
  },
  {
    id:     'product',
    title:  'Product display',
    blurb:  'Studio lighting and transmission glass, with the camera revolving and the pointer leaning the rig.',
    file:   'templates/product.ts',
    source: productSource,
    mount:  asStarterMount(mountProduct as never),
  },
]

const KEYWORDS = [
  'import', 'export', 'from', 'const', 'let', 'function', 'return', 'if', 'else',
  'for', 'of', 'in', 'new', 'interface', 'type', 'extends', 'implements', 'void',
  'class', 'static', 'as', 'default', 'async', 'await', 'throw', 'try', 'catch',
  'this', 'null', 'undefined', 'true', 'false',
]

const TOKENS = new RegExp([
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1: comments
  '(\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2: strings
  `\\b(${KEYWORDS.join('|')})\\b`, // 3: keywords
  '\\b(\\d+\\.?\\d*)\\b', // 4: numbers
].join('|'), 'g')

function escapeHtml (source: string): string {
  return source.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// A ~20-line highlighter beats pulling in a syntax-highlighting dependency for
// three files of TypeScript. Quotes are deliberately left unescaped above so
// the string pattern still matches.
function highlight (source: string): string {
  return escapeHtml(source).replace(TOKENS, (match, comment, string, keyword, number) => {
    if (comment)
      return `<i data-t="c">${comment}</i>`
    if (string)
      return `<i data-t="s">${string}</i>`
    if (keyword)
      return `<i data-t="k">${keyword}</i>`
    if (number)
      return `<i data-t="n">${number}</i>`
    return match
  })
}

const tabs    = document.querySelector<HTMLElement>('[data-tabs]')
const stage   = document.querySelector<HTMLElement>('[data-stage]')
const codeEl  = document.querySelector<HTMLElement>('[data-code]')
const titleEl = document.querySelector<HTMLElement>('[data-title]')
const blurbEl = document.querySelector<HTMLElement>('[data-blurb]')
const fileEl  = document.querySelector<HTMLElement>('[data-filename]')
const copyBtn = document.querySelector<HTMLButtonElement>('[data-copy]')

if (!tabs || !stage || !codeEl || !titleEl || !blurbEl || !fileEl)
  throw new Error('starters: page scaffold missing')

let current: App<never> | null = null
let currentId                  = ''

function freshCanvas (): HTMLCanvasElement {
  stage!.replaceChildren()

  const canvas = document.createElement('canvas')
  canvas.id    = 'scene'
  stage!.append(canvas)
  return canvas
}

function select (starter: Starter): void {
  if (currentId === starter.id)
    return

  current?.dispose()
  current   = null
  currentId = starter.id

  for (const button of tabs!.querySelectorAll('button'))
    button.setAttribute('aria-current', String(button.dataset.id === starter.id))

  titleEl!.textContent = starter.title
  blurbEl!.textContent = starter.blurb
  fileEl!.textContent  = starter.file
  codeEl!.innerHTML    = highlight(starter.source)

  current = starter.mount(freshCanvas())
  current.start()
}

for (const starter of STARTERS) {
  const button       = document.createElement('button')
  button.type        = 'button'
  button.dataset.id  = starter.id
  button.textContent = starter.title
  button.addEventListener('click', () => select(starter))
  tabs.append(button)
}

copyBtn?.addEventListener('click', async () => {
  const starter = STARTERS.find(s => s.id === currentId)
  if (!starter)
    return
  await navigator.clipboard?.writeText(starter.source)
  copyBtn.textContent = 'Copied'
  setTimeout(() => copyBtn.textContent = 'Copy', 1400)
})

// dev-only inspection hook — lets a browser console (or an agent) walk the live
// scene graph. Stripped from production builds by the import.meta.env guard.
if (import.meta.env.DEV)
  Object.assign(window, { __starter: () => current })

// The source pane collapses to a rail so the preview can have the full width —
// worth having on a page whose left half is the actual subject.
const sourcePane   = document.querySelector<HTMLElement>('[data-source]')
const sourceToggle = document.querySelector<HTMLButtonElement>('[data-source] [data-collapse]')
if (sourcePane && sourceToggle)
  attachCollapse({
    panel:      sourcePane,
    button:     sourceToggle,
    storageKey: 'threejs-scene:source-collapsed',
    labels:     { open: 'Hide source', closed: 'Show source' },
  })

// deep-link support: /starters.html#hovership opens that template
const requested = STARTERS.find(s => s.id === location.hash.slice(1))
select(requested ?? STARTERS[0]!)

// one live context, always — release it when the page goes away
addEventListener('pagehide', () => current?.dispose())

if (import.meta.hot)
  import.meta.hot.dispose(() => current?.dispose())
