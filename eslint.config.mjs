// Minimal, auto-fixable readability rules (R-525): split multi-var declarations, require braces on
// multi-line control flow, deduplicate and group imports, and add breathing room between blocks.
// Formatting details (quotes, semicolons, line wrapping) stay in Prettier.
import stylistic from '@stylistic/eslint-plugin'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      '.test-output/**',
      '.claude/**',
      '.local-backups/**',
      '.next/**',
      '.codex-remote-attachments/**',
      'graphify-out/**',
      'release/**',
      'build/**',
      'docs/**',
    ],
  },
  {
    files: ['{src,shared,electron,tests,scripts}/**/*.{ts,tsx,mjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@stylistic': stylistic,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'one-var': ['error', 'never'],
      curly: ['error', 'multi-line'],
      'no-duplicate-imports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node built-ins and external packages.
            ['^node:', '^@?\\w'],
            // Shared pure-logic and contract modules.
            ['^(\\.\\./)+shared/'],
            // Same-layer and child relative imports (excluding CSS).
            ['^\\.\\.(?!/?$)', '^\\.\\./?$', '^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            // Side-effect and CSS imports last.
            ['^\\u0000', '\\.css$'],
          ],
        },
      ],
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['function', 'class', 'interface', 'type', 'multiline-export'],
        },
        {
          blankLine: 'always',
          prev: ['function', 'class', 'interface', 'type', 'multiline-export'],
          next: '*',
        },
        { blankLine: 'any', prev: 'type', next: 'type' },
      ],
    },
  },
  {
    // CSS cascade order in main.tsx is significant: style.css -> video-player.css -> themes.css.
    files: ['src/main.tsx'],
    rules: {
      'simple-import-sort/imports': 'off',
    },
  },
]
