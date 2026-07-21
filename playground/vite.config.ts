import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'


export default defineConfig({
  resolve: {
    alias: {
      Δ: fileURLToPath(new URL('../lib', import.meta.url)),
      ꭍ: fileURLToPath(new URL('../modules', import.meta.url)),
    },
  },
})
