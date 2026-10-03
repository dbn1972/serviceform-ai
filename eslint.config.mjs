// Flat ESLint config for every TypeScript workspace. Lint rules are a CI gate:
// warnings fail the build (--max-warnings=0). Do not disable rules to pass CI (AGENTS.md).
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'apps/mobile/**',
      'docs/**',
      'evidence/**',
      'playwright-report/**',
      'test-results/**',
      // Intentional violations used to test the Semgrep rules.
      'tests/semgrep/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  security.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='query'] > TemplateLiteral[expressions.length>0]",
          message: 'Use parameterised queries, never interpolated SQL.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['apps/web-*/**/*.{ts,tsx}', 'packages/ui-ux4g/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
    settings: {
      next: {
        rootDir: ['apps/web-citizen/', 'apps/web-officer/', 'apps/web-studio/', 'apps/web-admin/'],
      },
    },
  },
  {
    files: ['**/scripts/**/*.{ts,mjs}', 'tests/**/*.ts', '**/test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
