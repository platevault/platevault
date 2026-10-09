// @ts-check
// ESLint carries only the i18n catalogue gate (port of apps/desktop's
// `alm/*` rules): every user-visible string comes from messages/en-GB.json
// through `m.<key>()` from '@/lib/i18n'. Type checking stays with `tsc`.
//
// Two tiers, so the extraction can land folder by folder (design/I18N.md):
//   - I18N_MIGRATED: a hardcoded string is an error.
//   - everything else under src/: the same rules warn, and
//     scripts/check-eslint-baseline.mjs holds each file's warning count to
//     scripts/eslint-i18n-baseline.json, so existing debt is reported, new
//     debt fails, and the baseline only shrinks.
// To migrate a folder, move its glob into I18N_MIGRATED and regenerate the
// baseline.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import alm from "./eslint-rules/no-user-string.js"

const I18N_MIGRATED = ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"]

// Not user-facing product copy, so outside the gate (legacy research R4):
//   - tests and fixtures carry assertion and sample literals; the seed is the
//     fixture store's sample library (user data, not UI copy);
//   - the design-system reference is a review surface, like the legacy
//     component stories: its labels describe states shown to a reviewer;
//   - the simulation controls are the prototype's dev surface (the legacy
//     src/dev/**): they fake the outside world and never ship in a product.
const I18N_IGNORES = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/__fixtures__/**",
  "src/domain/seed.ts",
  "src/app/design-system-page.tsx",
  "src/app/simulation-panel.tsx",
  "src/features/t4/prototype-controls.tsx",
]

export default defineConfig(
  {
    ignores: ["node_modules/**", "dist/**", "src/paraglide/**", "eslint-rules/**", "eslint.config.js", "vite.config.ts"],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { alm },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: I18N_IGNORES,
    rules: {
      "alm/no-user-string": "warn",
      // JS-side pluralisation ('s'/'es' suffix ternaries, paired
      // singular/plural calls) bakes English plural rules into code; use an
      // inlang plural variant message instead.
      "alm/no-js-plural": "warn",
    },
  },
  {
    files: I18N_MIGRATED,
    ignores: I18N_IGNORES,
    rules: {
      "alm/no-user-string": "error",
      "alm/no-js-plural": "error",
    },
  },
)
