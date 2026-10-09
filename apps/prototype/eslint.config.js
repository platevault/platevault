// @ts-check
// ESLint carries only the i18n catalogue gate (port of apps/desktop's
// `alm/*` rules): every user-visible string comes from messages/en-GB.json
// through `m.<key>()` from '@/lib/i18n'. A hardcoded string is an error
// anywhere under src/ (design/I18N.md). Type checking stays with `tsc`.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import alm from "./eslint-rules/no-user-string.js"

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
      "alm/no-user-string": "error",
      // JS-side pluralisation ('s'/'es' suffix ternaries, paired
      // singular/plural calls) bakes English plural rules into code; use an
      // inlang plural variant message instead.
      "alm/no-js-plural": "error",
    },
  },
)
