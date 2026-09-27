import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      '.local/**',
      'lib/db/generated/**',
      // Vendored OCR runtime: minified third-party bundles, not our source.
      'public/ocr/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The spec forbids `any` and unvalidated casts.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Application code logs through `lib/logger`, which redacts context and
      // silences tracing outside development. A bare `console` call bypasses
      // both, so it is banned outright rather than merely discouraged.
      'no-console': 'error',
    },
  },
  {
    // Operational scripts and seeds legitimately write to stdout, and
    // lib/logger is the one module allowed to reach console directly.
    files: [
      'scripts/**/*.ts',
      // A script is a script whatever it is written in. The glob was `.ts`
      // only because every script was, until one needed to run under plain
      // node without a loader.
      'scripts/**/*.mjs',
      'prisma/seed.ts',
      'prisma/seed/**/*.ts',
      'lib/logger.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
