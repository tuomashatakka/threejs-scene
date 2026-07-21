import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'


// The site consumes the BUILT package (dist), exactly as a consumer would:
// `@tuomashatakka/threejs-scene` and its `/modules/*` subpaths resolve to dist.
// Run `bun run build` (tsc → dist) before `dev`/`build:site`.
const dist = (path: string) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url))

export default defineConfig({
  // relative asset URLs → portable across the GitHub Pages project subpath
  base: './',

  resolve: {
    alias: [
      { find: /^@tuomashatakka\/threejs-scene\/modules\/(.*)$/, replacement: `${dist('modules/')}$1.js` },
      { find: '@tuomashatakka/threejs-scene', replacement: dist('lib/index.js') },
    ],
  },

  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        app:   fileURLToPath(new URL('./app.html', import.meta.url)),
      },
    },
  },
})
