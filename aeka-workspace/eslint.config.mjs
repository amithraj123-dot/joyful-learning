import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build output, dependency stores and vendored minified files.
    'dist/**',
    '.sites-runtime/**',
    '.wrangler/**',
    'desktop/node_modules/**',
    'desktop/ui-dist/**',
    'desktop/release/**',
    'desktop/generated/**',
    '**/pdf.worker.min.mjs',
    'vendor/**',
    // Android app: Gradle outputs and caches (test reports contain JavaScript).
    'android/**/build/**',
    'android/.gradle/**',
    'android/.kotlin/**',
  ]),
  {
    // Electron main/preload files are CommonJS by design.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Known debt carried over from 0.5: loosely typed runtime payloads and older effect patterns.
    // Reported as warnings so lint is a usable gate; tighten file by file.
    files: ['app/**/*.tsx', 'components/*.tsx', 'hooks/**/*.ts', 'lib/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    files: ['components/ui/**/*.{ts,tsx}', 'hooks/use-mobile.ts'],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);

export default eslintConfig;
