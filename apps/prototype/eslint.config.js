// @ts-check
// ESLint carries the i18n catalogue gate (port of apps/desktop's `alm/*`
// rules): every user-visible string comes from messages/en-GB.json through
// `m.<key>()` from '@/lib/i18n'. A hardcoded string is an error anywhere
// under src/ (design/I18N.md). It also enforces the composition rules
// (eslint-rules/composition.js) as errors on the files of units that
// finished their migration (`COMPOSITION_ENFORCED`, the W3 ratchet); the
// rest of src/ reports them through eslint.composition.config.js until W4.
// Type checking stays with `tsc`.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"
import { areaImportPatterns, COMPOSITION_SYNTAX } from "./eslint-rules/composition.js"
import alm from "./eslint-rules/no-user-string.js"

// Outside the gate: only tests and fixtures, which carry assertion and
// sample literals (design/I18N.md "The gate"). Everything a user can see,
// the component catalogue, the design-system page and the simulation and
// Prototype controls included, goes through the catalogue. A genuinely
// non-user string (proper name, code identifier) takes a per-line
// `eslint-disable-next-line alm/no-user-string -- <reason>`.
export const I18N_IGNORES = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__fixtures__/**"]

/**
 * Files held to the composition rules as errors, one unit at a time as it
 * lands (R9-COMPOSITION-PLAN.md §7.4): file lists, never a whole directory
 * another unit still shares. `area` gives a feature's I4-I6 import
 * boundary; app-shell files (src/app) take the syntax rules only, as in
 * eslint.composition.config.js.
 * @type {Array<{ unit: string, area: { dir: string, depth: number } | null, files: string[] }>}
 */
export const COMPOSITION_ENFORCED = [
  {
    unit: "P8 Calibration",
    area: { dir: "v5/e-targets-plan-settings", depth: 0 },
    files: ["src/features/v5/e-targets-plan-settings/{calibration,calibration-process,dialogs,calibration-model}.{ts,tsx}"],
  },
  {
    unit: "P7 Targets",
    area: { dir: "v5/e-targets-plan-settings", depth: 0 },
    files: ["src/features/v5/e-targets-plan-settings/{targets,target,planned-tools,moon-limits,targets-model,parts,targets-presets}.{ts,tsx}"],
  },
  {
    unit: "P1 Shell",
    area: null,
    files: ["src/app/{shell,status-bar,issues-hub,command-palette,onboarding,shortcuts,history,appearance,run-ui}.tsx", "src/app/{navigation,ui-state}.ts"],
  },
  {
    // d-review is P4's alone (R9-COMPOSITION-PLAN.md §7.4), so the whole area is enforced.
    unit: "P4 Review",
    area: { dir: "v5/d-review", depth: 0 },
    files: ["src/features/v5/d-review/**/*.{ts,tsx}"],
  },
  {
    // a-home is shared with P2 (Home), so P3's files are listed.
    unit: "P3 Sessions",
    area: { dir: "v5/a-home", depth: 0 },
    files: ["src/features/v5/a-home/{sessions,session,session-intake,import,import-preview,import-model,import-run,parts,session-model,shell}.{ts,tsx}"],
  },
  {
    // P2's Home in the shared a-home area; with P3's list above every a-home source file is enforced.
    unit: "P2 Home",
    area: { dir: "v5/a-home", depth: 0 },
    files: ["src/features/v5/a-home/home.tsx"],
  },
  {
    // b-projects is P5's alone.
    unit: "P5 Projects",
    area: { dir: "v5/b-projects", depth: 0 },
    files: ["src/features/v5/b-projects/**/*.{ts,tsx}"],
  },
  {
    // c-runs is P6's alone.
    unit: "P6 Runs",
    area: { dir: "v5/c-runs", depth: 0 },
    files: ["src/features/v5/c-runs/**/*.{ts,tsx}"],
  },
  {
    // P11 (with the Language step) owns t1/setup and t1/lib; location-attention.tsx is its shared Locations state badge.
    unit: "P11 Setup",
    area: { dir: "t1", depth: 1 },
    files: ["src/features/t1/setup/**/*.{ts,tsx}", "src/features/t1/lib/**/*.{ts,tsx}", "src/features/t1/components/location-attention.tsx"],
  },
  {
    // e-targets-plan-settings is shared with P7, P8 and P10, so P11's Activity files are listed.
    unit: "P11 Activity",
    area: { dir: "v5/e-targets-plan-settings", depth: 0 },
    files: ["src/features/v5/e-targets-plan-settings/activity{,.test}.tsx"],
  },
  {
    // t1/components also holds the deprecated form-field and row-menu, which only P10's files still import; only P9's rebuilt files are listed.
    unit: "P9 Settings A",
    area: { dir: "t1", depth: 1 },
    files: ["src/features/t1/settings/**/*.{ts,tsx}", "src/features/t1/components/{add-location-flow,duplicates-review,location-actions,form-blockers}.{ts,tsx}"],
  },
  {
    // t4 is P9's alone.
    unit: "P9 Settings A",
    area: { dir: "t4", depth: 0 },
    files: ["src/features/t4/**/*.{ts,tsx}"],
  },
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
  ...COMPOSITION_ENFORCED.map(({ area, files }) => {
    /** @type {import("eslint").Linter.RulesRecord} */
    const rules = { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX] }
    if (area) rules["no-restricted-imports"] = ["error", { patterns: areaImportPatterns(area) }]
    return { files, ignores: I18N_IGNORES, rules }
  }),
)
