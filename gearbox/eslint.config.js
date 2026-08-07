// Flat ESLint config.
//
// The important part of this file is not the style rules — it is the architectural
// boundaries from docs/gearbox/03-architecture.md §3.5, enforced so that "modular
// monolith" stays true as the codebase grows:
//
//   1. packages/* must never import from services/* or apps/*.
//   2. Inside gearbox-core, a module may only reach another module through its
//      ports/ directory — never a deep import into domain/, application/,
//      infrastructure/ or http/.
//
// Rule 2 works on the import specifier itself. Files live at
// `modules/<name>/<layer>/file.ts`, so a cross-module import is always `../../<other>/…`
// while a module's own internals are `../<layer>/…`. Matching `../../*/<layer>/**`
// therefore catches exactly the imports we want to forbid and nothing else.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const PRIVATE_LAYERS = ['domain', 'application', 'infrastructure', 'http'];

const crossModuleDeepImports = PRIVATE_LAYERS.flatMap((layer) => [
  `../../*/${layer}/*`,
  `../../*/${layer}/**`,
  `../../../*/${layer}/*`,
  `../../../*/${layer}/**`,
]);

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/Generated/**',
      '**/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Untyped objects are banned by the coding standards (master prompt §31).
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // Rule 2 — module isolation inside the monolith.
    files: ['services/*/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: crossModuleDeepImports,
              message:
                'Cross-module deep import. Import another module only through its ports/ directory (docs/gearbox/02-stack.md §2.5).',
            },
          ],
        },
      ],
    },
  },
  {
    // Rule 1 — packages/* is the leaf of the dependency graph.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/**', '**/apps/**', '@gearbox/core', '@gearbox/core/**'],
              message:
                'packages/* must not depend on services/* or apps/* (docs/gearbox/03-architecture.md §3.5 rule 2).',
            },
          ],
        },
      ],
    },
  },
  {
    // Node-side code: services, build scripts, config.
    files: ['services/**/*.ts', 'packages/**/*.ts', '**/*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Build and smoke scripts run in Node, but page.evaluate() callbacks are shipped
    // to the browser and legitimately reference DOM globals from inside this file.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Client code runs in a browser and legitimately touches DOM and WebGL globals.
    files: ['apps/**/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.test.ts', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
