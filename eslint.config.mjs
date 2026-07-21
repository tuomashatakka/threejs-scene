import config from '@tuomashatakka/eslint-config'


export default [
  // build output isn't linted source; site/ TS is linted, its Vite build is not.
  { ignores: [ 'dist/**', 'node_modules/**', 'coverage/**', 'site/dist/**' ]},
  ...config,
]
