// @ts-check
// Composition rules (design/R9-COMPOSITION-PLAN.md §8.1-§8.2): core
// `no-restricted-syntax` and `no-restricted-imports` only, no new dependency.
// The selectors and import patterns live in eslint-rules/composition.js.
//
// Report mode until W4. This config reports them as warnings over src/;
// `pnpm lint:composition` (scripts/report-composition-lint.mjs) counts them
// per rule against design/R10-CENSUS-BASELINE.json. The gate
// (`eslint --max-warnings 0 src/`, which reads eslint.config.js) enforces
// them as errors only on the files of units that finished their migration
// (`COMPOSITION_ENFORCED`); W4 moves the rest there. Outside those files
// nothing in src/ may carry an `eslint-disable … no-restricted-syntax`
// directive: the gate does not run the rule there, so it reports such a
// directive as unused.
import { defineConfig } from "eslint/config"
import base, { I18N_IGNORES } from "./eslint.config.js"
import { AREAS, areaImportPatterns, COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"

/** §8.1 Exempt: tests and fixtures, plus the review and dev surfaces (the reference page, the catalogue, the simulation panel and the Prototype controls), which show components out of their composed context. */
const EXEMPT = [
  ...I18N_IGNORES,
  "src/app/design-system-page.tsx",
  "src/app/catalogue/**",
  "src/app/simulation-panel.tsx",
  "src/features/t4/prototype-controls.tsx",
]

/** @param {{ dir: string, depth: number }} area */
function areaImports(area) {
  return {
    files: [`src/features/${area.dir}/**/*.{ts,tsx}`],
    ignores: EXEMPT,
    rules: { "no-restricted-imports": ["warn", { patterns: areaImportPatterns(area) }] },
  }
}

export default defineConfig(
  ...base,
  {
    files: ["src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: EXEMPT,
    rules: { "no-restricted-syntax": ["warn", ...COMPOSITION_SYNTAX] },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/components/app/**", "@/components/templates/**", "@/features/**", "@/store/**"],
              message: "[I1] components/ui imports no patterns, templates, features or store.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/app/**/*.{ts,tsx}", "src/components/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@base-ui/**", "@/features/**", "@/components/templates/**"],
              message: "[I2] Patterns import Base UI through components/ui, and never features or templates.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/templates/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        { patterns: [{ group: ["@/features/**", "@/store/actions/**"], message: "[I3] Templates import no features and no store actions." }] },
      ],
    },
  },
  ...AREAS.map(areaImports),
)
