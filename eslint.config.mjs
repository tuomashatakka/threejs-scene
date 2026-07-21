import config from '@tuomashatakka/eslint-config'


export default [
  // docs/ is the published GitHub Pages site (static HTML/CSS + a browser demo
  // and vendored build output), not linted library source.
  { ignores: [ 'dist/**', 'node_modules/**', 'playground/dist/**', 'coverage/**', 'docs/**' ]},
  ...config,
]
