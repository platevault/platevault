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

// toast/notify-style call targets whose first string arg is shown to the user.
const TOAST_NAMES = new Set([
  "toast",
  "notify",
  "showToast",
  "addToast",
  "pushToast",
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
        const val = stringLiteralValue(arg);
        if (val !== null && hasLetter(val)) {
          context.report({
            node: arg,
            messageId: "toast",
            data: { text: quote(val) },
          });
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
