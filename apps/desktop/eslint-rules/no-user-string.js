/**
 * ESLint rule: alm/no-user-string (spec 046, FR-001 / FR-012 / SC-001 / SC-002).
 *
 * Flags hardcoded user-facing strings so they must come from the Paraglide
 * message catalog (messages/en.json, accessed via `m.*()` from '@/lib/i18n')
 * instead of being written inline in components.
 *
 * What it flags:
 *   - JSX text nodes that contain a letter            <button>Save</button>
 *   - A fixed set of user-facing JSX attributes       placeholder="Search…"
 *     (placeholder, title, alt, aria-label, aria-description, aria-placeholder,
 *      aria-roledescription, aria-valuetext, label)
 *   - String-literal first argument to a toast/notify call   toast('Saved')
 *
 * What it deliberately ignores (machine strings, not user-facing):
 *   - Any attribute not in the user-facing set (className, id, data-*, key,
 *     type, role, href, to, name, value, …) — never inspected.
 *   - Strings with no letters (numbers, punctuation, symbols, paths, hex).
 *   - Anything excluded by eslint.config.js globs (bindings, paraglide,
 *     messages, tests, fixtures, mocks, dev surface).
 *
 * Escape hatch for a genuine non-user string:
 *   // eslint-disable-next-line alm/no-user-string -- <reason>
 */

const USER_ATTRS = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
]);

// toast/notify/dialog-style call targets whose first arg is shown to the user.
// The first arg may be a bare string OR an object carrying user-facing fields.
const TOAST_NAMES = new Set([
  "toast",
  "notify",
  "showToast",
  "addToast",
  "pushToast",
  "confirm",
]);


// Object-property keys whose string values are user-facing prose when they
// appear in data structures (nav configs, table columns, status maps, dialog
// defs). Deliberately excludes machine-ish keys like `name`, `id`, `key`,
// `value`, `path`, `route`, `icon`, `variant` to keep false positives low.
const LABEL_PROP_KEYS = new Set([
  "label",
  "heading",
  "subtitle",
  "placeholder",
  "tooltip",
  "cta",
  "emptyText",
  "confirmLabel",
  "cancelLabel",
]);

// Keys carrying user-facing text specifically inside a toast/dialog CALL arg
// (addToast({message}), confirm({title, body})). These keys are too common in
// machine/internal objects to flag globally, but in a toast/dialog call they
// are always shown to the user.
const TOAST_OBJECT_PROPS = new Set(["message", "title", "body", "description"]);

const hasLetter = (s) => /\p{L}/u.test(s);

// A template literal carries user-facing prose when any of its static text
// chunks (quasis) contains a letter, e.g. `Sort by ${col}` or `Remove ${name}`.
// Pure-interpolation templates with no letters (`${a}-${b}`, `${x}px`) are
// machine strings and are ignored.
const templateHasLetter = (node) =>
  node.type === "TemplateLiteral" &&
  node.quasis.some((q) => hasLetter(q.value.cooked ?? q.value.raw ?? ""));

// A short preview of a template literal for the diagnostic: static chunks kept,
// interpolations shown as `${…}`.
const templatePreview = (node) =>
  node.quasis
    .map((q, i) => (q.value.cooked ?? "") + (i < node.expressions.length ? "${…}" : ""))
    .join("");

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded user-facing strings; source them from the message catalog.",
    },
    schema: [],
    messages: {
      jsxText:
        "Hardcoded user-facing text {{text}}. Move it into messages/en.json and use m.<key>() from '@/lib/i18n'. If it is not user-facing, add `// eslint-disable-next-line alm/no-user-string -- <reason>`.",
      attr:
        "Hardcoded user-facing `{{attr}}` string {{text}}. Move it into messages/en.json and use m.<key>(). If not user-facing, add `// eslint-disable-next-line alm/no-user-string -- <reason>`.",
      toast:
        "Hardcoded user-facing toast string {{text}}. Move it into messages/en.json and use m.<key>().",
    },
  },

  create(context) {
    const quote = (raw) => {
      const t = raw.trim().replace(/\s+/g, " ");
      const clip = t.length > 32 ? `${t.slice(0, 32)}…` : t;
      return `"${clip}"`;
    };

    const stringLiteralValue = (node) => {
      if (!node) return null;
      if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
      }
      // value={"…"} wrapper
      if (
        node.type === "JSXExpressionContainer" &&
        node.expression &&
        node.expression.type === "Literal" &&
        typeof node.expression.value === "string"
      ) {
        return node.expression.value;
      }
      return null;
    };

    return {
      JSXText(node) {
        if (node.value.trim() !== "" && hasLetter(node.value)) {
          context.report({
            node,
            messageId: "jsxText",
            data: { text: quote(node.value) },
          });
        }
      },

      // String literals rendered as a JSX CHILD via an expression container,
      // e.g. `{busy ? 'Working…' : 'Remove'}` or `{ok && 'Done'}`. These reach
      // the screen but aren't JSXText, so they need a separate check. We only
      // flag a literal whose nearest enclosing JSX context is a child
      // expression container (NOT an attribute, and NOT a call argument — those
      // are handled by JSXAttribute / the toast handler).
      Literal(node) {
        if (typeof node.value !== "string" || !hasLetter(node.value)) return;
        // Skip comparison operands and switch-case tests: these are machine
        // discriminants (`x === 'recursive'`, `case 'done':`), not rendered text.
        const p0 = node.parent;
        if (
          p0 &&
          ((p0.type === "BinaryExpression" &&
            ["===", "!==", "==", "!="].includes(p0.operator)) ||
            p0.type === "SwitchCase")
        ) {
          return;
        }
        let n = node;
        let parent = n.parent;
        while (parent) {
          // Stop if we're inside a call (toast/other) or an attribute — handled
          // elsewhere or intentionally ignored (machine strings).
          if (parent.type === "JSXAttribute" || parent.type === "CallExpression") {
            return;
          }
          if (parent.type === "JSXExpressionContainer") {
            // Rendered as a child only when the container's parent is an element
            // or fragment (not an attribute).
            const gp = parent.parent;
            if (gp && (gp.type === "JSXElement" || gp.type === "JSXFragment")) {
              context.report({
                node,
                messageId: "jsxText",
                data: { text: quote(node.value) },
              });
            }
            return;
          }
          // Don't cross function boundaries — a literal inside a nested arrow/
          // function passed as a child isn't simply "rendered text".
          if (
            parent.type === "ArrowFunctionExpression" ||
            parent.type === "FunctionExpression" ||
            parent.type === "JSXElement" ||
            parent.type === "JSXFragment"
          ) {
            return;
          }
          n = parent;
          parent = n.parent;
        }
      },

      // Template literals rendered as a JSX CHILD via an expression container,
      // e.g. `{ok ? `Applied ${n} items` : `Failed`}`. Mirror of the Literal
      // child check above. Attribute / object-property / call template literals
      // are handled by their own visitors, so those contexts are skipped here to
      // avoid double-reporting.
      TemplateLiteral(node) {
        if (!templateHasLetter(node)) return;
        if (node.parent && node.parent.type === "TaggedTemplateExpression") return;
        let n = node;
        let parent = n.parent;
        while (parent) {
          if (
            parent.type === "JSXAttribute" ||
            parent.type === "CallExpression" ||
            parent.type === "NewExpression" ||
            parent.type === "Property"
          ) {
            return;
          }
          if (parent.type === "JSXExpressionContainer") {
            const gp = parent.parent;
            if (gp && (gp.type === "JSXElement" || gp.type === "JSXFragment")) {
              context.report({
                node,
                messageId: "jsxText",
                data: { text: quote(templatePreview(node)) },
              });
            }
            return;
          }
          if (
            parent.type === "ArrowFunctionExpression" ||
            parent.type === "FunctionExpression" ||
            parent.type === "JSXElement" ||
            parent.type === "JSXFragment"
          ) {
            return;
          }
          n = parent;
          parent = n.parent;
        }
      },

      JSXAttribute(node) {
        const name =
          node.name && node.name.type === "JSXIdentifier"
            ? node.name.name
            : null;
        if (!name || !USER_ATTRS.has(name)) return;
        const val = stringLiteralValue(node.value);
        if (val !== null && hasLetter(val)) {
          context.report({
            node: node.value ?? node,
            messageId: "attr",
            data: { attr: name, text: quote(val) },
          });
          return;
        }
        // Template-literal value: aria-label={`Remove ${name}`} — user-facing
        // prose with interpolation. Must become a parameterized catalog message
        // m.<key>({ name }). Pure-interpolation templates (no letters) are skipped.
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          templateHasLetter(node.value.expression)
        ) {
          context.report({
            node: node.value.expression,
            messageId: "attr",
            data: { attr: name, text: quote(templatePreview(node.value.expression)) },
          });
          return;
        }
        // Ternary value: aria-label={open ? 'Collapse' : 'Expand'} — flag each
        // string-literal OR template-literal branch.
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          node.value.expression.type === "ConditionalExpression"
        ) {
          for (const branch of [
            node.value.expression.consequent,
            node.value.expression.alternate,
          ]) {
            if (
              branch.type === "Literal" &&
              typeof branch.value === "string" &&
              hasLetter(branch.value)
            ) {
              context.report({
                node: branch,
                messageId: "attr",
                data: { attr: name, text: quote(branch.value) },
              });
            } else if (templateHasLetter(branch)) {
              context.report({
                node: branch,
                messageId: "attr",
                data: { attr: name, text: quote(templatePreview(branch)) },
              });
            }
          }
        }
      },

      // User-facing string literals declared as object properties in data
      // structures (nav configs, table column defs, status-label maps, etc.),
      // e.g. `{ label: 'Sessions' }` / `{ title: 'Export' }`. These reach the
      // screen via a variable, so the JSX visitors never see them.
      Property(node) {
        if (
          node.computed ||
          node.key.type !== "Identifier" ||
          !LABEL_PROP_KEYS.has(node.key.name)
        ) {
          return;
        }
        if (
          node.value.type === "Literal" &&
          typeof node.value.value === "string" &&
          hasLetter(node.value.value)
        ) {
          context.report({
            node: node.value,
            messageId: "attr",
            data: { attr: node.key.name, text: quote(node.value.value) },
          });
        } else if (templateHasLetter(node.value)) {
          context.report({
            node: node.value,
            messageId: "attr",
            data: { attr: node.key.name, text: quote(templatePreview(node.value)) },
          });
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        let calleeName = null;
        if (callee.type === "Identifier") calleeName = callee.name;
        else if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier"
        ) {
          calleeName = callee.property.name;
        }
        if (!calleeName || !TOAST_NAMES.has(calleeName)) return;
        const arg = node.arguments[0];
        // Bare-string form: toast('Saved')
        const val = stringLiteralValue(arg);
        if (val !== null && hasLetter(val)) {
          context.report({
            node: arg,
            messageId: "toast",
            data: { text: quote(val) },
          });
          return;
        }
        // Object form: addToast({ message: 'Saved' }) / confirm({ title, body }).
        if (arg && arg.type === "ObjectExpression") {
          for (const prop of arg.properties) {
            if (
              prop.type !== "Property" ||
              prop.key.type !== "Identifier" ||
              !TOAST_OBJECT_PROPS.has(prop.key.name)
            ) {
              continue;
            }
            const pv = stringLiteralValue(prop.value);
            if (pv !== null && hasLetter(pv)) {
              context.report({
                node: prop.value,
                messageId: "toast",
                data: { text: quote(pv) },
              });
            }
          }
        }
      },
    };
  },
};

// alm/no-js-plural (spec 046 task #7). Flags JS-side pluralization — a ternary
// whose branches are a lone plural suffix and empty string, e.g.
// `count !== 1 ? 's' : ''` (inline) or `{ suffix: n === 1 ? '' : 's' }` (param).
// This bakes English plural rules into code; the message catalog can't localize
// them. Use an inlang plural VARIANT message instead
// (declarations/selectors/match → Intl.PluralRules), called m.<key>({ count }).
/** @type {import('eslint').Rule.RuleModule} */
const noJsPlural = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JS-side pluralization (lone suffix ternaries); use an inlang plural variant message.",
    },
    schema: [],
    messages: {
      jsPlural:
        "JS-side pluralization {{text}} bakes English plural rules into code. Use an inlang plural variant message (declarations/selectors/match) called as m.<key>({ count }). If genuinely not a plural, add `// eslint-disable-next-line alm/no-js-plural -- <reason>`.",
    },
  },
  create(context) {
    const PLURAL = new Set(["s", "es", "ies"]);
    return {
      ConditionalExpression(node) {
        const branches = [node.consequent, node.alternate];
        if (
          !branches.every(
            (b) => b.type === "Literal" && typeof b.value === "string",
          )
        ) {
          return;
        }
        const vals = branches.map((b) => b.value);
        const isSuffixOrEmpty = (v) => v === "" || PLURAL.has(v);
        if (vals.every(isSuffixOrEmpty) && vals.some((v) => PLURAL.has(v))) {
          context.report({
            node,
            messageId: "jsPlural",
            data: { text: `\`${vals.map((v) => v || "∅").join("/")}\`` },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    "no-user-string": rule,
    "no-js-plural": noJsPlural,
  },
};
