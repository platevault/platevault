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

// Object properties that carry user-facing text when passed to a toast/dialog
// call (e.g. addToast({ message }), confirm({ title, body })).
const USER_OBJECT_PROPS = new Set([
  "message",
  "title",
  "body",
  "description",
  "label",
  "confirmLabel",
  "cancelLabel",
]);

const hasLetter = (s) => /\p{L}/u.test(s);

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
        // Object form: addToast({ message: 'Saved' }) / confirm({ title, body })
        if (arg && arg.type === "ObjectExpression") {
          for (const prop of arg.properties) {
            if (
              prop.type !== "Property" ||
              prop.key.type !== "Identifier" ||
              !USER_OBJECT_PROPS.has(prop.key.name)
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

export default {
  rules: {
    "no-user-string": rule,
  },
};
