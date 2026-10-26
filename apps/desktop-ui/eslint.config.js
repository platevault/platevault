// @ts-check
// ESLint enforces localisation and composition/import rules over production source.
// Every user-visible string comes from messages/en-GB.json through m.<key>().
// Composition rules L1-L11 and import boundaries I1-I7 are errors.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import composition, { COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"
import pv from "./eslint-rules/no-user-string.js"

// Only test and fixture literals sit outside the user-visible copy scan.
export const I18N_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__fixtures__/**"]

// Composition rules L1-L11 govern everything that composes the component library. The library itself
// (src/components), the test harness and the catalogue review surfaces build or show primitives directly.
export const COMPOSITION_EXEMPT = [
  ...I18N_IGNORES,
  "src/components/**",
  "src/test/**",
  "src/app/catalogue/**",
  "src/app/design-system-page.tsx",
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
    ignores: COMPOSITION_EXEMPT,
    rules: { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX], "composition/components": "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "composition/imports": "error" },
  },
)