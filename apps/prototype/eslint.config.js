// @ts-check
// ESLint carries the i18n catalogue gate (port of apps/desktop's `alm/*`
// rules): every user-visible string comes from messages/en-GB.json through
// `m.<key>()` from '@/lib/i18n'. A hardcoded string is an error anywhere
// under src/ (design/I18N.md). It also enforces the composition rules
// (eslint-rules/composition.js; design/R9-COMPOSITION-PLAN.md §8.1-§8.2) as
// errors over src/ since W4: the L1-L11 syntax rules on src/features and
// src/app, the I1-I3 layer boundaries on src/components, and each feature
// area's I4-I6 import boundary. `pnpm lint:composition`
// (scripts/report-composition-lint.mjs) counts them per rule.
// Type checking stays with `tsc`.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import { AREAS, areaImportPatterns, COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"
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

/**
 * @param {string[]} files
 * @param {string[]} group
 * @param {string} message
 */
function layerImports(files, group, message) {
  return { files, rules: { "no-restricted-imports": ["error", { patterns: [{ group, message }] }] } }
}

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
  {
    files: ["src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: COMPOSITION_EXEMPT,
    rules: { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX] },
  },
  layerImports(
    ["src/components/ui/**/*.{ts,tsx}"],
    ["@/components/app/**", "@/components/templates/**", "@/features/**", "@/store/**"],
    "[I1] components/ui imports no patterns, templates, features or store.",
  ),
  layerImports(
    ["src/components/app/**/*.{ts,tsx}", "src/components/domain/**/*.{ts,tsx}"],
    ["@base-ui/**", "@/features/**", "@/components/templates/**"],
    "[I2] Patterns import Base UI through components/ui, and never features or templates.",
  ),
  layerImports(["src/components/templates/**/*.{ts,tsx}"], ["@/features/**", "@/store/actions/**"], "[I3] Templates import no features and no store actions."),
  ...AREAS.map((area) => ({
    files: [`src/features/${area.dir}/**/*.{ts,tsx}`],
    ignores: COMPOSITION_EXEMPT,
    rules: { "no-restricted-imports": ["error", { patterns: areaImportPatterns(area) }] },
  })),
)
