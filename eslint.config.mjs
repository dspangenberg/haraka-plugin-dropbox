import haraka from '@haraka/eslint-config'
import globals from 'globals'

export default [
  ...haraka,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
  },
]
