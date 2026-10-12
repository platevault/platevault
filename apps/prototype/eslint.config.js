// @ts-check
// ESLint carries only the i18n catalogue gate (port of apps/desktop's
// `alm/*` rules): every user-visible string comes from messages/en-GB.json
// through `m.<key>()` from '@/lib/i18n'. A hardcoded string is an error
// anywhere under src/ (design/I18N.md). Type checking stays with `tsc`.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import alm from "./eslint-rules/no-user-string.js"

// Outside the gate: only tests and fixtures, which carry assertion and
// sample literals (design/I18N.md "The gate"). Everything a user can see,
// the component catalogue, the design-system page and the simulation and
// Prototype controls included, goes through the catalogue. A genuinely
// non-user string (proper name, code identifier) takes a per-line
// `eslint-disable-next-line alm/no-user-string -- <reason>`.
export const I18N_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__fixtures__/**"]

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
