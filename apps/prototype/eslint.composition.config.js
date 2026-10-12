// @ts-check
// Composition rules (design/R9-COMPOSITION-PLAN.md §8.1-§8.2): core
// `no-restricted-syntax` and `no-restricted-imports` only, no new dependency.
//
// Report mode until W4. These rules live in their own config so the gate
// (`eslint --max-warnings 0 src/`, which reads eslint.config.js) never sees
// their warnings; `pnpm lint:composition` (scripts/report-composition-lint.mjs)
// counts them per rule against design/R10-CENSUS-BASELINE.json. W4 moves the
// blocks into eslint.config.js as "error". Until then nothing in src/ may
// carry an `eslint-disable … no-restricted-syntax` directive: the gate does
// not run the rule, so it reports such a directive as unused.
//
// Every message starts with its rule id ([L1]…[L11], [I1]…[I6]); the report
// groups by that id.
import { defineConfig } from "eslint/config"
import base, { I18N_IGNORES } from "./eslint.config.js"

/** §8.1 Exempt: the i18n ignores (the simulation panel, the Prototype controls, the reference page and the catalogue). */
const EXEMPT = I18N_IGNORES

/** Truncated text is the one place a `title` may stay (§6.2 T2). */
const TRUNCATES = "/(^|\\s)(truncate|line-clamp-\\d)(\\s|$)/"

/** Elements whose `title` becomes a native tooltip: intrinsic elements and the components that pass it through. Heading props (`PageHeader title`) are not tooltips. */
const TOOLTIP_TITLE = "/^([a-z]\\w*|Button|Link|Pill|Badge|Toggle|ToggleGroupItem|TabsTrigger)$/"

/** Arbitrary size utilities, also behind a variant prefix (`md:w-[…]`). */
const ARBITRARY_SIZE = "/(^|[\\s:])(min-|max-)?(w|h|size|text|gap|p[xytrbl]?|m[xytrbl]?|inset|top|left)-\\[/"

/** §8.1 L1-L10, plus L11 for the feature-local Button and Menu wrappers that P1/P2 delete. */
const COMPOSITION_SYNTAX = [
  {
    selector: "JSXOpeningElement[name.name=/^(table|thead|tbody|tr|th|td|button|select|input|textarea|dialog|details|summary)$/]",
    message: "[L1] No raw interactive or table markup: use DataTable / Button / Field from @/components/app.",
  },
  {
    selector: "JSXOpeningElement[name.name='Pill'] > JSXAttribute[name.name=/^(onClick|link|href)$/]",
    message: "[L2] Pills are display-only: a link or button is a Button or a HoverCard trigger.",
  },
  {
    selector: "CallExpression[callee.name='pillClass']",
    message: "[L2] Pills are display-only: do not style a control as a pill.",
  },
  {
    selector: "JSXOpeningElement[name.name=/^(Button|Badge|Pill|StatusBadge|DataTable|Box|PageHeader|ConfirmDialog)$/] > JSXAttribute[name.name='className']",
    message: "[L3] No restyling shared components: the component's variants carry its look.",
  },
  {
    selector: "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='variant'][value.value='secondary']",
    message: "[L4] Button roles only: primary, standard (outline), quiet (ghost), destructive or link; secondary is removed.",
  },
  {
    selector: "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='size'][value.value=/^(lg|icon|icon-xs|icon-lg)$/]",
    message: "[L4] Button roles only: sizes are sm, default, xs (in table cells) and icon-sm.",
  },
  {
    selector: "JSXOpeningElement[name.name='SheetContent']",
    message: "[L5] No side fold-outs: tasks open a FormDialog, details the DetailPanel, previews a HoverCard.",
  },
  {
    selector: `JSXOpeningElement[name.name=${TOOLTIP_TITLE}]:not(:has(JSXAttribute[name.name='className'] :matches(Literal[value=${TRUNCATES}], TemplateElement[value.raw=${TRUNCATES}]))) > JSXAttribute[name.name='title']`,
    message: "[L6] No title= tooltips: only truncated text shows its full text (§6.2).",
  },
  {
    selector: "JSXOpeningElement[name.name='HelpTip']",
    message: "[L7] HelpTip needs a reason: at most one per page, with lead approval (§6.2 T4).",
  },
  {
    selector: `Literal[value=${ARBITRARY_SIZE}]`,
    message: "[L8] No arbitrary sizes: use the space, control, row and dialog tokens.",
  },
  {
    selector: `TemplateElement[value.raw=${ARBITRARY_SIZE}]`,
    message: "[L8] No arbitrary sizes: use the space, control, row and dialog tokens.",
  },
  {
    selector: "JSXAttribute[name.name='style']",
    message: "[L9] No inline style.",
  },
  {
    selector: "JSXOpeningElement[name.name=/^(div|span|section|ul|ol|li|p|header|footer|nav|aside)$/] > JSXAttribute[name.name='className']",
    message: "[L10] Layout belongs to templates: pages fill template slots.",
  },
  {
    selector: "FunctionDeclaration[id.name=/^[A-Z]\\w*(Button|Menu|RowActions)$/]",
    message: "[L11] No feature-local Button or Menu wrappers: pass an Action to ActionBar, ActionMenu or RowActions.",
  },
  {
    selector: "VariableDeclarator[id.name=/^[A-Z]\\w*(Button|Menu|RowActions)$/] > :matches(ArrowFunctionExpression, FunctionExpression)",
    message: "[L11] No feature-local Button or Menu wrappers: pass an Action to ActionBar, ActionMenu or RowActions.",
  },
]

/** §8.2: feature areas; each may import only itself among features. `depth` is how far a file sits below the area root. */
const AREAS = [
  { dir: "t1", depth: 1 },
  { dir: "t3", depth: 0 },
  { dir: "t4", depth: 0 },
  { dir: "v5/a-home", depth: 0 },
  { dir: "v5/b-projects", depth: 0 },
  { dir: "v5/c-runs", depth: 0 },
  { dir: "v5/d-review", depth: 0 },
  { dir: "v5/e-targets-plan-settings", depth: 0 },
]

const CROSS_FEATURE = "[I6] No cross-feature imports: shared code belongs in components/app or domain."

/** @param {{ dir: string, depth: number }} area */
function areaImports(area) {
  return {
    files: [`src/features/${area.dir}/**/*.{ts,tsx}`],
    ignores: EXEMPT,
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            { group: ["@base-ui/**"], message: "[I4] Features never import Base UI: go through the components." },
            { group: ["@/components/ui/**"], message: "[I5] Features compose components/app and templates, not components/ui (end state)." },
            // The plan's gitignore negation (`!@/features/<area>/**`) cannot re-include a path under an excluded parent, so a lookahead keeps the area's own files.
            { regex: `^@/features/(?!${area.dir}(/|$))`, message: CROSS_FEATURE },
            // A relative path that climbs out of the area is a cross-feature import too.
            { regex: `^(\\.\\./){${area.depth + 1}}`, message: CROSS_FEATURE },
          ],
        },
      ],
    },
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
