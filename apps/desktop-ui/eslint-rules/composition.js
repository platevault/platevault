// @ts-check
// The composition rules (design/R9-COMPOSITION-PLAN.md §8.1-§8.2). The gate
// (eslint.config.js) enforces them as errors over src/ (W4):
// - COMPOSITION_SYNTAX: core `no-restricted-syntax` selectors for the rules
//   that look at markup alone (L1, L8-L11).
// - `composition/components`: the rules about a named component or prop
//   (L2-L7). It resolves the component through import and const aliases and
//   reads props from statically known spreads, which a selector cannot.
// - `composition/imports`: the layer and area import boundaries (I1-I6). It
//   resolves `@/` and relative specifiers, `..` included, to a path under src/
//   before matching layers, which `no-restricted-imports` patterns cannot.
// Every message starts with its rule id ([L1]…[L11], [I1]…[I6]); the report
// (scripts/report-composition-lint.mjs) groups by that id.
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Arbitrary size utilities, also behind a variant prefix (`md:w-[…]`). */
const ARBITRARY_SIZE = "/(^|[\\s:])(min-|max-)?(w|h|size|text|gap|p[xytrbl]?|m[xytrbl]?|inset|top|left)-\\[/"

const L8 = "[L8] No arbitrary sizes: use the space, control, row and dialog tokens."
const L11 = "[L11] No feature-local Button or Menu wrappers: pass an Action to ActionBar, ActionMenu or RowActions."

/** §8.1 L1 and L8-L10, plus L11 for the feature-local Button and Menu wrappers that P1/P2 delete. */
export const COMPOSITION_SYNTAX = [
  {
    selector: "JSXOpeningElement[name.name=/^(table|thead|tbody|tr|th|td|button|select|input|textarea|dialog|details|summary)$/]",
    message: "[L1] No raw interactive or table markup: use DataTable / Button / Field from @/components/app.",
  },
  { selector: `Literal[value=${ARBITRARY_SIZE}]`, message: L8 },
  { selector: `TemplateElement[value.raw=${ARBITRARY_SIZE}]`, message: L8 },
  { selector: "JSXAttribute[name.name='style']", message: "[L9] No inline style." },
  {
    selector: "JSXOpeningElement[name.name=/^(div|span|section|ul|ol|li|p|header|footer|nav|aside)$/] > JSXAttribute[name.name='className']",
    message: "[L10] Layout belongs to templates: pages fill template slots.",
  },
  { selector: "FunctionDeclaration[id.name=/^[A-Z]\\w*(Button|Menu|RowActions)$/]", message: L11 },
  { selector: "VariableDeclarator[id.name=/^[A-Z]\\w*(Button|Menu|RowActions)$/] > :matches(ArrowFunctionExpression, FunctionExpression)", message: L11 },
]

/** L2: a Pill with any of these is a control. */
const PILL_CONTROL_PROPS = new Set(["onClick", "link", "href"])
/** L3: shared components whose variants carry their look. */
const RESTYLED = new Set(["Button", "Badge", "Pill", "StatusBadge", "DataTable", "Box", "PageHeader", "ConfirmDialog"])
/** L4: the removed Button variant and sizes. */
const RETIRED_BUTTON = { variant: new Set(["secondary"]), size: new Set(["lg", "icon", "icon-xs", "icon-lg"]) }
/** L6: components that pass `title` through as a native tooltip, besides every intrinsic element. Heading props (`PageHeader title`) are not tooltips. */
const TOOLTIP_TITLE = new Set(["Button", "Link", "Pill", "Badge", "Toggle", "ToggleGroupItem", "TabsTrigger"])

/** The node types that only wrap an expression for the type checker. */
const TS_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"])

/** @param {any} node */
function unwrap(node) {
  while (node && TS_WRAPPERS.has(node.type)) node = node.expression
  return node
}

/**
 * The definition an identifier binds to, from the scope it is used in.
 * @param {any} sourceCode
 * @param {any} node an Identifier or JSXIdentifier
 */
function definitionOf(sourceCode, node) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name)
    if (variable) return variable.defs[0]
  }
  return undefined
}

/**
 * The initializer of a `const` binding, which no later assignment changes.
 * @param {any} sourceCode
 * @param {any} node an Identifier
 */
function constInit(sourceCode, node) {
  const definition = definitionOf(sourceCode, node)
  return definition?.type === "Variable" && definition.parent?.kind === "const" ? definition.node.init : undefined
}

/**
 * The exported name a component or function reference stands for: through
 * `import { Pill as P }`, `const P = Pill`, `const P = App.Pill` and `<App.Pill>`.
 * A default or namespace import keeps its local name.
 * @param {any} sourceCode
 * @param {any} node
 * @param {Set<string>} [seen]
 * @returns {string}
 */
function canonicalName(sourceCode, node, seen = new Set()) {
  node = unwrap(node)
  if (!node) return ""
  if (node.type === "JSXMemberExpression" || (node.type === "MemberExpression" && !node.computed)) return node.property.name
  if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return ""
  if (seen.has(node.name)) return node.name
  seen.add(node.name)
  const definition = definitionOf(sourceCode, node)
  if (definition?.type === "ImportBinding" && definition.node.type === "ImportSpecifier") {
    return definition.node.imported.name ?? definition.node.imported.value
  }
  const init = definition?.type === "Variable" && definition.parent?.kind === "const" ? unwrap(definition.node.init) : undefined
  if (init && (init.type === "Identifier" || (init.type === "MemberExpression" && !init.computed))) return canonicalName(sourceCode, init, seen)
  return node.name
}

/**
 * The string values an expression can statically take: literals, branches of
 * `?:`, `&&`, `||` and `??`, and `const` bindings. Unknown parts add nothing.
 * @param {any} sourceCode
 * @param {any} node
 * @param {Set<any>} [seen]
 * @returns {string[]}
 */
function staticValues(sourceCode, node, seen = new Set()) {
  node = unwrap(node)
  if (!node || seen.has(node)) return []
  seen.add(node)
  switch (node.type) {
    case "Literal":
      return node.value === null ? [] : [String(node.value)]
    case "TemplateLiteral":
      return node.expressions.length === 0 ? [node.quasis[0].value.cooked] : []
    case "JSXExpressionContainer":
      return staticValues(sourceCode, node.expression, seen)
    case "ConditionalExpression":
      return [...staticValues(sourceCode, node.consequent, seen), ...staticValues(sourceCode, node.alternate, seen)]
    case "LogicalExpression":
      return [...staticValues(sourceCode, node.left, seen), ...staticValues(sourceCode, node.right, seen)]
    case "Identifier": {
      const init = constInit(sourceCode, node)
      return init ? staticValues(sourceCode, init, seen) : []
    }
    default:
      return []
  }
}

/**
 * @typedef {{ name: string, node: any, value: any }} Prop
 * One prop an element receives: its name, the node to report, and its value expression (null for a bare attribute).
 */

/**
 * The props a spread argument statically carries: object literals, their
 * nested spreads, both branches of `?:`, the object of `cond && {…}`, and
 * `const` bindings. A parameter, a call result or `{...rest}` adds nothing.
 * @param {any} sourceCode
 * @param {any} node
 * @param {any} reportNode
 * @param {Set<any>} [seen]
 * @returns {Prop[]}
 */
function spreadProps(sourceCode, node, reportNode, seen = new Set()) {
  node = unwrap(node)
  if (!node || seen.has(node)) return []
  seen.add(node)
  switch (node.type) {
    case "ObjectExpression":
      return node.properties.flatMap((/** @type {any} */ property) => {
        if (property.type === "SpreadElement") return spreadProps(sourceCode, property.argument, reportNode, seen)
        if (property.computed) return []
        const name = property.key.type === "Identifier" ? property.key.name : String(property.key.value)
        return [{ name, node: reportNode, value: property.value }]
      })
    case "ConditionalExpression":
      return [...spreadProps(sourceCode, node.consequent, reportNode, seen), ...spreadProps(sourceCode, node.alternate, reportNode, seen)]
    case "LogicalExpression":
      return spreadProps(sourceCode, node.right, reportNode, seen)
    case "Identifier": {
      const init = constInit(sourceCode, node)
      return init ? spreadProps(sourceCode, init, reportNode, seen) : []
    }
    default:
      return []
  }
}

/**
 * Every prop an opening element receives, its own attributes and its static spreads.
 * @param {any} sourceCode
 * @param {any} opening
 * @returns {Prop[]}
 */
function propsOf(sourceCode, opening) {
  return opening.attributes.flatMap((/** @type {any} */ attribute) => {
    if (attribute.type === "JSXSpreadAttribute") return spreadProps(sourceCode, attribute.argument, attribute)
    if (attribute.name.type !== "JSXIdentifier") return []
    return [{ name: attribute.name.name, node: attribute, value: attribute.value }]
  })
}

/** §8.1 L2-L7: the rules about a named component or one of its props. */
const components = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: { description: "Composition rules L2-L7 over resolved component names and static spread props (design/R9-COMPOSITION-PLAN.md §8.1)." },
    schema: [],
    messages: {
      pillControl: "[L2] Pills are display-only: a link or button is a Button or a HoverCard trigger.",
      pillClass: "[L2] Pills are display-only: do not style a control as a pill.",
      restyle: "[L3] No restyling shared components: the component's variants carry its look.",
      buttonVariant: "[L4] Button roles only: primary, standard (outline), quiet (ghost), destructive or link; secondary is removed.",
      buttonSize: "[L4] Button roles only: sizes are sm, default, xs (in table cells) and icon-sm.",
      sideFoldOut: "[L5] No side fold-outs: tasks open a FormDialog, details the DetailPanel, previews a HoverCard.",
      titleTooltip: "[L6] No title= tooltips: truncated text gets its full text from onPointerEnter={titleWhenCut}, only when it is cut (§6.2 T2).",
      helpTip: "[L7] HelpTip needs a reason: at most one per page, with lead approval (§6.2 T4).",
    },
  },
  /** @param {any} context */
  create(context) {
    const sourceCode = context.sourceCode
    /** @param {Prop} prop @param {Set<string>} retired */
    const takes = (prop, retired) => staticValues(sourceCode, prop.value).some((value) => retired.has(value))
    return {
      /** @param {any} node */
      CallExpression(node) {
        if (canonicalName(sourceCode, node.callee) === "pillClass") context.report({ node, messageId: "pillClass" })
      },
      /** @param {any} node */
      JSXOpeningElement(node) {
        const intrinsic = node.name.type === "JSXIdentifier" && /^[a-z]/.test(node.name.name)
        const tag = intrinsic ? node.name.name : canonicalName(sourceCode, node.name)
        if (tag === "SheetContent") context.report({ node, messageId: "sideFoldOut" })
        if (tag === "HelpTip") context.report({ node, messageId: "helpTip" })
        for (const prop of propsOf(sourceCode, node)) {
          if (tag === "Pill" && PILL_CONTROL_PROPS.has(prop.name)) context.report({ node: prop.node, messageId: "pillControl" })
          if (RESTYLED.has(tag) && prop.name === "className") context.report({ node: prop.node, messageId: "restyle" })
          if (tag === "Button" && prop.name === "variant" && takes(prop, RETIRED_BUTTON.variant)) context.report({ node: prop.node, messageId: "buttonVariant" })
          if (tag === "Button" && prop.name === "size" && takes(prop, RETIRED_BUTTON.size)) context.report({ node: prop.node, messageId: "buttonSize" })
          if ((intrinsic || TOOLTIP_TITLE.has(tag)) && prop.name === "title") context.report({ node: prop.node, messageId: "titleTooltip" })
        }
      },
    }
  },
}

/** Final rebuild feature ownership from the approved plan; each area imports only itself. */
export const AREAS = ["library", "projects", "jd2rc", "targets", "calibration", "settings"]

/** Whether `target` is `dir` or lies below it. @param {string} target @param {string} dir */
const within = (target, dir) => target === dir || target.startsWith(`${dir}/`)

/** §8.2 I1-I3: what each component layer may not import, as resolved targets. */
const LAYER_BANS = [
  { layer: "src/components/ui", messageId: "I1", banned: ["src/components/app", "src/components/templates", "src/features", "src/store"] },
  { layer: "src/components/app", messageId: "I2", banned: ["@base-ui", "src/features", "src/components/templates"] },
  { layer: "src/components/domain", messageId: "I2", banned: ["@base-ui", "src/features", "src/components/templates"] },
  { layer: "src/components/templates", messageId: "I3", banned: ["src/features", "src/store/actions"] },
]

/** The app root (apps/desktop-ui): paths are matched relative to the package root. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * An import specifier as a path under the app root (`src/…`), or the bare
 * package name it names. `@/` is the src alias (tsconfig `paths`).
 * @param {string} specifier
 * @param {string} file the importing file, relative to the app root
 */
function resolveSpecifier(specifier, file) {
  if (specifier.startsWith("@/")) return path.posix.normalize(`src/${specifier.slice(2)}`)
  if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
  }
  return specifier
}

/**
 * The bans that apply to one file: its layer's (I1-I3), or its feature area's (I4-I6).
 * @param {string} file relative to the app root
 * @returns {{ messageId: string, banned: (target: string) => boolean }[]}
 */
function bansFor(file) {
  const layer = LAYER_BANS.find((ban) => within(file, ban.layer))
  if (layer) return [{ messageId: layer.messageId, banned: (target) => layer.banned.some((dir) => within(target, dir)) }]
  const area = AREAS.map((dir) => `src/features/${dir}`).find((dir) => within(file, dir))
  if (!area) return []
  return [
    { messageId: "I4", banned: (target) => within(target, "@base-ui") },
    { messageId: "I5", banned: (target) => within(target, "src/components/ui") },
    { messageId: "I6", banned: (target) => within(target, "src/features") && !within(target, area) },
  ]
}

/** §8.2 I1-I6 over resolved import paths. */
const imports = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: { description: "Layer and feature-area import boundaries I1-I6 over resolved paths (design/R9-COMPOSITION-PLAN.md §8.2)." },
    schema: [],
    messages: {
      I1: "[I1] components/ui imports no patterns, templates, features or store.",
      I2: "[I2] Patterns import Base UI through components/ui, and never features or templates.",
      I3: "[I3] Templates import no features and no store actions.",
      I4: "[I4] Features never import Base UI: go through the components.",
      I5: "[I5] Features compose components/app and templates, not components/ui (end state).",
      I6: "[I6] No cross-feature imports: shared code belongs in components/app or domain.",
    },
  },
  /** @param {any} context */
  create(context) {
    const file = path.relative(APP_ROOT, context.filename).split(path.sep).join("/")
    const bans = bansFor(file)
    if (bans.length === 0) return {}
    /** @param {any} source the specifier's string Literal */
    function check(source) {
      if (source?.type !== "Literal" || typeof source.value !== "string") return
      const target = resolveSpecifier(source.value, file)
      for (const { messageId, banned } of bans) if (banned(target)) context.report({ node: source, messageId })
    }
    return {
      /** @param {any} node */
      ImportDeclaration: (node) => check(node.source),
      /** @param {any} node */
      ExportNamedDeclaration: (node) => check(node.source),
      /** @param {any} node */
      ExportAllDeclaration: (node) => check(node.source),
      /** @param {any} node */
      ImportExpression: (node) => check(node.source),
    }
  },
}

/** The `composition` plugin: L2-L7 and I1-I6. */
export default { rules: { components, imports } }
