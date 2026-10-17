// @ts-check
// ESLint carries the i18n catalogue gate (port of apps/desktop's `alm/*`
// rules): every user-visible string comes from messages/en-GB.json through
// `m.<key>()` from '@/lib/i18n'. A hardcoded string is an error anywhere
// under src/ (design/I18N.md). It also enforces the composition rules
// (eslint-rules/composition.js; design/R9-COMPOSITION-PLAN.md §8.1-§8.2) as
// errors over src/ since W4: the L1-L11 rules on src/features and src/app,
// the I1-I3 layer boundaries on src/components, and each feature area's
// I4-I6 import boundary. `pnpm lint:composition`
// (scripts/report-composition-lint.mjs) counts them per rule. Every
// eslint-disable directive names its reason after ` -- `
// (`alm/require-disable-reason`).
// Type checking stays with `tsc`.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import composition, { COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"
import alm from "./eslint-rules/no-user-string.js"

// Outside the gate: only tests and fixtures, which carry assertion and
// sample literals (design/I18N.md "The gate"). Everything a user can see,
// the component catalogue, the design-system page and the simulation
// controls included, goes through the catalogue. A genuinely non-user
// string (proper name, code identifier) takes a per-line
// `eslint-disable-next-line alm/no-user-string -- <reason>`.
export const I18N_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__fixtures__/**"]

/**
 * §8.1 Exempt from the composition rules: tests and fixtures, plus the review
 * and dev surfaces (the reference page, the catalogue and the simulation
 * panel), which show components out of their composed context.
 */
export const COMPOSITION_EXEMPT = [...I18N_IGNORES, "src/app/design-system-page.tsx", "src/app/catalogue/**", "src/app/simulation-panel.tsx"]

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
    plugins: { alm, composition },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "alm/require-disable-reason": "error" },
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
  {
    files: ["src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: COMPOSITION_EXEMPT,
    rules: { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX], "composition/components": "error" },
  },
  // I1-I3 hold for every file of a component layer, its tests included.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: { "composition/imports": "error" },
  },
  // I4-I6, for each feature area of eslint-rules/composition.js AREAS.
  {
    files: ["src/features/**/*.{ts,tsx}"],
    ignores: COMPOSITION_EXEMPT,
    rules: { "composition/imports": "error" },
  },
)
