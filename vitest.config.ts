import { defineConfig } from 'vitest/config'


export default defineConfig({
  resolve: {
    alias: {
      Δ: './lib',
      ꭍ: './modules',
    },
  },
  test: {
    environment:     'node',
    include:         [ 'tests/**/*.test.ts' ],
    passWithNoTests: true,
  },
})
