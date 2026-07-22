import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'


// The site consumes the BUILT package (dist), exactly as a consumer would:
// `threejs-scene` and its `/modules/*` subpaths resolve to dist.
// Run `bun run build` (tsc → dist) before `dev`/`build:site`.
const dist = (path: string) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url))

export default defineConfig({
  // relative asset URLs → portable across the GitHub Pages project subpath
  base: './',

  resolve: {
    alias: [
      // folder-with-index modules resolve to their index.js (first match wins)
      { find: /^threejs-scene\/modules\/(lighting|orbit|post|assets)$/, replacement: `${dist('modules/')}$1/index.js` },
      { find: /^threejs-scene\/modules\/(.*)$/, replacement: `${dist('modules/')}$1.js` },
      { find: 'threejs-scene', replacement: dist('lib/index.js') },
    ],
  },

  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    rollupOptions: {
      input: {
        index:    fileURLToPath(new URL('./index.html', import.meta.url)),
        app:      fileURLToPath(new URL('./app.html', import.meta.url)),
        starters: fileURLToPath(new URL('./starters.html', import.meta.url)),
      },
    },
  },
})
