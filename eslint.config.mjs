import config from '@tuomashatakka/eslint-config'


export default [
  { ignores: [ 'dist/**', 'node_modules/**', 'playground/dist/**', 'coverage/**' ]},
  ...config,
]
