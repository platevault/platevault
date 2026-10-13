// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// @ts-check
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import alm from './eslint-rules/no-user-string.js';
import noVacuousWaitFor from './eslint-rules/no-vacuous-waitfor.js';
import requireRootTestid from './eslint-rules/require-root-testid.js';

// ESLint is the SECOND lint layer, after Biome (`pnpm lint` runs
// `biome check` first). Biome owns the syntactic layer (core JS recommended +
// non-type-aware TS rules — see biome.json); ESLint keeps ONLY the gates Biome
// cannot replicate:
//
//   1. `alm/*` custom rules (the spec-046 i18n catalog gate and the
//      no-vacuous-waitfor test-hygiene gate) — Biome has no custom JS plugin
//      rules.
//   2. Type-aware @typescript-eslint rules (recommendedTypeCheckedOnly) —
//      Biome has no type-aware linting.
//   3. eslint-plugin-react-hooks v7 — its React-compiler-derived rules
//      (set-state-in-effect/-render, purity checks) have no Biome equivalent,
//      so the whole plugin stays here and Biome's two hook rules are disabled.
//   4. eslint-plugin-jsx-a11y recommended-at-error — Biome's a11y group is not
//      rule-for-rule equivalent (it both misses jsx-a11y checks and adds
//      different ones), so swapping would silently shift the a11y gate.
//   5. The `no-restricted-syntax` inline-style ban — Biome has no AST-selector
//      rule, and the existing opt-outs are eslint-disable comments.

// The i18n catalog migration is complete: the `alm/no-user-string` gate is
// enforced across ALL of src (spec 046, FR-001 / SC-001 met). Every string a
// story canvas renders goes through the message catalogue in en-GB and pt-BR,
// as product UI does. The i18n gate block below lists each excluded path with
// its reason; nothing else may be excluded.
//
// The per-line escape hatch `// eslint-disable-next-line alm/no-user-string --
// <reason>` is reserved for these classes, each carrying its reason inline:
//   - proper and brand names: PlateVault (window title, sidebar glyph),
//     PixInsight and Siril (processing-tool options);
//   - mathematical notation: Δ deltas, p95 percentile, degree symbols;
//   - code identifiers and paths: the project folder-tree preview;
//   - decorative glyphs: the InfoTip "i" icon;
//   - story index entries (meta `title`, story `name`): sidebar entries in the
//     workbench, not canvas copy. Storybook 10's CSF indexer
//     (storybook/internal/csf-tools, `CsfFile._parseTitle` and the story
//     annotation loop) reads them statically: a non-literal `title` throws
//     "CSF: unexpected dynamic title", and a non-literal `name` is ignored,
//     so the export name is shown instead. A catalogue call cannot be used
//     for either. The story ID comes from the title and the export name, not
//     from `name`. The rule flags `title`, so each one carries this disable;
//     it does not inspect `name`, so a `name` needs no disable.
//
// The rule also leaves `parameters.docs.description` alone. That is reviewer
// documentation, which the owner's rule exempts as internal docs, so it stays
// in English.
const I18N_MIGRATED = ['src/**/*.{ts,tsx}'];

export default tseslint.config(
  // TypeScript type-aware rules ONLY (the non-type-aware recommended set is
  // covered by Biome).
  ...tseslint.configs.recommendedTypeCheckedOnly,

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
    plugins: {
      alm: {
        rules: {
          ...alm.rules,
          ...noVacuousWaitFor.rules,
          ...requireRootTestid.rules,
        },
      },
    },
  },
  {
    files: I18N_MIGRATED,
    // Each entry below is excluded for a stated reason; everything else in
    // src/** is user-facing and goes through the message catalogue
    // (messages/en-GB.json + pt-BR.json). Never add an entry without one.
    ignores: [
      // Unit tests: assertion literals and test fixtures, never rendered.
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/__fixtures__/**',
      // Sample library records served by the mock IPC layer below and read by
      // tests; imported only from src/api/mocks.ts and *.test files, so they
      // ship in no release bundle.
      'src/data/fixtures/**',
      // Mock IPC layer: loaded only through `import('./mocks')` behind
      // `VITE_USE_MOCKS === 'true'` (src/api/ipc.ts). vite.config.ts defines
      // that flag as "false" unless set, and no release workflow sets it, so
      // the branch folds to `if (false)` and the chunk is never emitted into a
      // release bundle.
      'src/api/mocks.ts',
      'src/api/mocks/**',
      // Developer-tools surface: imported only behind `DEV_TOOLS_ENABLED`
      // (src/dev/devToolsEnabled.ts, VITE_DEV_TOOLS defined "false" by
      // vite.config.ts). Release builds compile it out; the release gate's
      // "dev-tools-off (frontend bundle)" check greps the built dist for it.
      // devToolsEnabled.ts itself ships but holds no strings.
      'src/dev/**',
    ],
    rules: {
      'alm/no-user-string': 'error',
      // JS-side pluralization ('s'/'es' suffix ternaries) bakes English plural
      // rules into code; use inlang plural variant messages instead (spec 046 #7).
      'alm/no-js-plural': 'error',
    },
  },

  // Exported React components must have data-testid on their root JSX element
  // so e2e tests can locate them without coupling to CSS class names.
  // Existing violations are baselined in scripts/eslint-alm-baseline.txt;
  // new violations (not in the baseline) fail the build immediately. This is
  // an e2e-locator gate, not the i18n gate, so its scope is kept separate and
  // unchanged: stories frame components for review, src/data holds stores and
  // context providers, and tests, fixtures, mocks and the dev surface are never
  // the subject of an e2e locator.
  {
    files: I18N_MIGRATED,
    ignores: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/*.stories.tsx',
      'src/stories/**',
      '**/__fixtures__/**',
      'src/api/mocks.ts',
      'src/api/mocks/**',
      'src/data/**',
      'src/dev/**',
    ],
    rules: {
      'alm/require-root-testid': 'error',
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
      // Allow floating promises in event handlers (we use void keyword consistently)
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Relax noisy type-safety rules — unsafe patterns are caught by TypeScript
      // strict mode; the eslint-level rules create too many false positives with
      // the Tauri command return type narrowing pattern.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
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
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // A negated mock-call assertion inside `waitFor` passes on the first
      // attempt and asserts nothing — the silent no-op a naive "wrap the flake
      // in waitFor" fix introduces. See the rule's header and
      // docs/development/testing.md (issue #1136).
      'alm/no-vacuous-waitfor': 'error',
    },
  },

  // Component-workbench stories: same carve-out as tests. A story frames a
  // component for review, so demo-only layout may be expressed inline rather
  // than promoted into the shared stylesheet.
  {
    files: ['**/*.stories.tsx', 'src/stories/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
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
      'vitest.storybook.config.ts',
      '.storybook/**',
      'eslint.config.js',
      // Custom rule files are plain JS executed by ESLint, not app source —
      // they are not in any tsconfig include, so type-aware rules cannot run
      // on them. Excluding here is equivalent to how eslint.config.js itself
      // is excluded.
      'eslint-rules/**',
    ],
  },
);
