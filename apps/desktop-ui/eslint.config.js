// @ts-check
// ESLint enforces i18n and composition rules over the production frontend.
// Every user-visible string comes from messages/en-GB.json through m.<key>().
// Composition rules L1-L11 and import boundaries I1-I6 are errors.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import composition, { COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"
import pv from "./eslint-rules/no-user-string.js"

// Only test and fixture literals sit outside the user-visible copy scan.
export const I18N_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__fixtures__/**"]

/**
 * Exempt from the composition rules: tests and fixtures, plus the review
 * surface (the component catalogue and its design-system page), which shows
 * components out of their composed context. Its copy still goes through the
 * message catalogue: the i18n rules above apply to it.
 */
export const COMPOSITION_EXEMPT = [...I18N_IGNORES, "src/app/catalogue/**"]

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
    plugins: { pv, composition },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "pv/require-disable-reason": "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: I18N_IGNORES,
    rules: {
      "pv/no-user-string": "error",
      "pv/no-js-plural": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/catalogue/**", "src/app/design-system-page.tsx"],
    rules: { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX], "composition/components": "error" },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
    rules: { "composition/imports": "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "composition/imports": "error" },
  },
)