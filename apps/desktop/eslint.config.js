// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import alm from './eslint-rules/no-user-string.js';

// The i18n catalog migration is complete: the `alm/no-user-string` gate is
// enforced across ALL of src (spec 046, FR-001 / SC-001 met). Non-user-facing
// exclusions (tests, fixtures, mocks, dev surface, generated) are listed in the
// gated config block's `ignores` below.
const I18N_MIGRATED = ['src/**/*.{ts,tsx}'];

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript type-checked rules for our source
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // i18n catalog gate (spec 046). Plugin is registered globally but only
  // ENFORCED on migrated areas (I18N_MIGRATED), so it can be rolled out wave by
  // wave without turning the whole tree red at once.
  {
    plugins: { alm },
  },
  {
    files: I18N_MIGRATED,
    // Tests, fixtures, mocks, and the dev-tools surface are out of SC-001 scope
    // (research R4): assertion literals are legitimate, and the dev surface is
    // compiled out of release builds.
    ignores: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/__fixtures__/**',
      'src/api/mocks.ts',
      'src/data/**',
      'src/dev/**',
    ],
    rules: {
      'alm/no-user-string': 'error',
      // JS-side pluralization ('s'/'es' suffix ternaries) bakes English plural
      // rules into code; use inlang plural variant messages instead (spec 046 #7).
      'alm/no-js-plural': 'error',
    },
  },

  // React hooks rules
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // set-state-in-effect flags async .then() callbacks inside useEffect as
      // "synchronous" setState — false positive for the fetch+cancel pattern
      // used throughout this codebase. Keep as warn so real sync cases are
      // visible but don't block CI.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Accessibility (eslint-plugin-jsx-a11y). The standard a11y gate, now enforced
  // at ERROR across src/** (the prior warn-level rollout has been fully remediated).
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...Object.fromEntries(
        Object.keys(jsxA11y.flatConfigs.recommended.rules).map((name) => [
          name,
          'error',
        ]),
      ),
      // `label-has-for` is DEPRECATED (superseded by `label-has-associated-control`)
      // and its `every: ['nesting','id']` requirement rejects valid htmlFor+id and
      // Base-UI labelled controls. Keep it off; `label-has-associated-control`
      // (enabled above) is the active, correct label-association gate.
      'jsx-a11y/label-has-for': 'off',
    },
  },

  // Project-wide rule overrides — keep pragmatic
  {
    rules: {
      // No element-level inline styling. Every visual style must be a shared
      // `alm-` class in styles/components.css (token-only), never an inline
      // `style={{…}}` block on an element. This keeps theming centralized and
      // prevents un-themed colors leaking past the 4-theme token system.
      //
      // The selector forbids ANY `style={…}` JSX prop. The few genuinely-dynamic
      // exceptions (virtualizer transforms/heights computed per row, progress-bar
      // widths, conditional token-based colors, SVG point geometry, and the
      // Table/WizardShell `style` API passthroughs) must opt out explicitly with:
      //   // eslint-disable-next-line no-restricted-syntax -- dynamic: <reason>
      // so each one is justified and new static inline styles are rejected.
      'no-restricted-syntax': ['error', {
        selector: 'JSXAttribute[name.name="style"]',
        message:
          'Inline style props are forbidden. Use a shared `alm-` class in styles/components.css (token-only). For a genuinely-dynamic value, add `// eslint-disable-next-line no-restricted-syntax -- dynamic: <reason>`.',
      }],
      // TypeScript: allow explicit `any` in generated bindings and adapter layers
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused vars prefixed with _ (convention for intentionally unused)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow non-null assertions — common in Tauri/DOM interop
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Allow floating promises in event handlers (we use void keyword consistently)
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Allow require() in config files (none in src but belt+suspenders)
      '@typescript-eslint/no-require-imports': 'error',
      // Relax noisy type-safety rules — unsafe patterns are caught by TypeScript
      // strict mode; the eslint-level rules create too many false positives with
      // the Tauri command return type narrowing pattern.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Allow empty interfaces for DTO-like types
      '@typescript-eslint/no-empty-object-type': 'warn',
      // Unnecessary type assertions are style issues, not bugs
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // TanStack Router uses `throw redirect()` — this is a framework convention
      '@typescript-eslint/only-throw-error': 'off',
      // require-await is too strict for mock stubs and optional async patterns
      '@typescript-eslint/require-await': 'warn',
      // no-misused-promises fires on event handler wrappers — common React pattern
      '@typescript-eslint/no-misused-promises': ['warn', {
        checksVoidReturn: { attributes: false },
      }],
      // no-base-to-string fires on DTO fields that TypeScript types as string
      '@typescript-eslint/no-base-to-string': 'warn',
      // Redundant union constituents — cosmetic, not a bug
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
    },
  },

  // Test files: `no-unnecessary-type-assertion` false-positives here because the
  // type-aware service lacks full test type info, and its autofix wrongly strips
  // load-bearing casts (e.g. `as HTMLInputElement`, `_Serialize`→prop casts).
  // Off for tests; it stays on for app source.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'off' },
  },

  // Scope: only lint app source (not generated bindings, not archived src)
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/bindings/**', 'src-archived-2026-05-24/**'],
  },

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'src-tauri/**',
      'src/bindings/**',
      'src/paraglide/**',
      'src-archived-2026-05-24/**',
      'playwright.config.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'eslint.config.js',
    ],
  },
);
