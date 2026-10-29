import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/app/**', '**/ui/**', '**/render/**', '**/input/**', '**/net/**', '**/storage/**'],
              message: 'core must not depend on outer layers',
            },
            {
              group: ['**/content/**'],
              message: 'core receives content by injection, never by import',
            },
          ],
        },
      ],
    },
  },
)
