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
 *   - String-literal OR template-literal first argument to a toast/notify
 *     call                                            toast(`Saved ${n} items`)
 *   - A prose string/template literal passed directly to a `useState` setter
 *     whose paired state variable is later rendered   setErrorMsg(`Hard-rule
 *     mismatch: ${dims.join(', ')}.`) … {errorMsg}
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
  // Component props that render user-facing prose in this codebase:
  //   <Command.Group heading="…">, <SettingsRow info="…">.
  "heading",
  "info",
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
  // Prose-bearing keys in config objects (nav/pane meta, option descriptions,
  // settings rows). `title`/`desc`/`description`/`body` are user-facing copy when
  // written inline in a data structure.
  "title",
  "desc",
  "description",
  "body",
]);

// Keys carrying user-facing text specifically inside a toast/dialog CALL arg
// (addToast({message}), confirm({title, body})). These keys are too common in
// machine/internal objects to flag globally, but in a toast/dialog call they
// are always shown to the user.
const TOAST_OBJECT_PROPS = new Set(["message", "title", "body", "description"]);

const hasLetter = (s) => /\p{L}/u.test(s);

// True for `useState(...)` / `React.useState(...)` call expressions. Used to
// pair a destructured `[state, setState]` so a prose string/template handed
// directly to the setter can be traced to the state variable's later render.
const isUseStateCall = (node) => {
  if (!node || node.type !== "CallExpression") return false;
  const c = node.callee;
  if (c.type === "Identifier") return c.name === "useState";
  if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier") {
    return c.property.name === "useState";
  }
  return false;
};

// Distinguishes machine tokens from display prose. Used to gate the
// variable-tracing check, where the value's role isn't vouched for by an
// attribute/property name: a string rendered through a variable is only flagged
// when it actually reads like UI copy. Machine = a single identifier-shaped
// token (`pending`, `no_match`, `setupIncomplete`), SCREAMING_SNAKE, or a
// token/path/pattern containing `{}` placeholders or slashes and no spaces.
// Prose = anything with whitespace, or a Capitalized standalone word
// (`None`, `All`, `Sort`).
const looksMachine = (s) => {
  const t = s.trim();
  if (t === "") return true;
  if (/\s/.test(t)) return false; // any whitespace → display prose
  if (/[{}]/.test(t)) return true; // token/naming pattern, e.g. {target}_{filter}
  if (/^[a-z][\w.-]*$/.test(t)) return true; // lowercase-initial token: pending, no_match, fooBar
  if (/^[A-Z0-9_]+$/.test(t)) return true; // SCREAMING_SNAKE / ALL_CAPS
  // Path/URL/glob fragment made of word chars, dots, hyphens, and at least one
  // slash, e.g. `/library/`, `api/v2/`, `mock-${id}/preview` — a machine token
  // even though it doesn't start with a lowercase letter (a leading `/`).
  if (/\//.test(t) && /^[\w./-]+$/.test(t)) return true;
  return false;
};

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

// True when an expression evaluates to (or can short-circuit to) user-facing
// prose: a letter-bearing string literal or template, OR a conditional / logical
// (`?:`, `??`, `||`, `&&`) whose operands include such a value. Used to flag
// user strings that reach the screen through a variable, a `??` fallback, etc.,
// which the per-node JSX visitors don't see directly.
const isUserStringExpr = (node) => {
  if (!node) return false;
  if (node.type === "Literal" && typeof node.value === "string") {
    return hasLetter(node.value);
  }
  if (node.type === "TemplateLiteral") return templateHasLetter(node);
  if (node.type === "ConditionalExpression") {
    return isUserStringExpr(node.consequent) || isUserStringExpr(node.alternate);
  }
  if (node.type === "LogicalExpression") {
    return isUserStringExpr(node.left) || isUserStringExpr(node.right);
  }
  return false;
};

// A printable preview of any user-string expression for the diagnostic.
const userStringPreview = (node) => {
  if (node.type === "Literal") return String(node.value);
  if (node.type === "TemplateLiteral") return templatePreview(node);
  if (node.type === "ConditionalExpression") {
    return (
      (isUserStringExpr(node.consequent) ? userStringPreview(node.consequent) : "…") +
      " / " +
      (isUserStringExpr(node.alternate) ? userStringPreview(node.alternate) : "…")
    );
  }
  if (node.type === "LogicalExpression") {
    return isUserStringExpr(node.left)
      ? userStringPreview(node.left)
      : userStringPreview(node.right);
  }
  return "…";
};

// Like isUserStringExpr but requires at least one prose-like leaf (not a machine
// token). Gates the variable-tracing check so rendered enum/status values
// (`'pending'`, `'no_match'`) aren't flagged as translatable copy.
const userStringHasProse = (node) => {
  if (!node) return false;
  if (node.type === "Literal" && typeof node.value === "string") {
    return hasLetter(node.value) && !looksMachine(node.value);
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis.some((q) => {
      const s = q.value.cooked ?? q.value.raw ?? "";
      return hasLetter(s) && !looksMachine(s);
    });
  }
  if (node.type === "ConditionalExpression") {
    return userStringHasProse(node.consequent) || userStringHasProse(node.alternate);
  }
  if (node.type === "LogicalExpression") {
    return userStringHasProse(node.left) || userStringHasProse(node.right);
  }
  return false;
};

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
      variable:
        "Hardcoded user-facing string {{text}} assigned to `{{name}}` and rendered. Move it into messages/en.json and use m.<key>(). If not user-facing, add `// eslint-disable-next-line alm/no-user-string -- <reason>`.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // setterName -> Variable (the paired state variable) for every
    // `const [state, setState] = useState(...)` seen so far. Populated as
    // VariableDeclarators are visited; hooks are called unconditionally near
    // the top of a component, so the pairing is in place before the setter is
    // ever invoked in the same file.
    const stateSetterPairs = new Map();

    // True when a referenced identifier reaches the screen: as a JSX child
    // expression, or as the value of a user-facing JSX attribute. Forwarding
    // expressions (`?:`, `??`, `||`, templates, concatenation) are followed; a
    // value handed to a call or a non-user attribute is NOT considered rendered.
    const isRenderedUsage = (idNode) => {
      let n = idNode;
      let p = n.parent;
      while (p) {
        if (p.type === "JSXExpressionContainer") {
          const gp = p.parent;
          if (gp && (gp.type === "JSXElement" || gp.type === "JSXFragment")) return true;
          if (gp && gp.type === "JSXAttribute") {
            const an =
              gp.name && gp.name.type === "JSXIdentifier" ? gp.name.name : null;
            return an != null && USER_ATTRS.has(an);
          }
          return false;
        }
        if (
          p.type === "ConditionalExpression" ||
          p.type === "LogicalExpression" ||
          p.type === "TemplateLiteral" ||
          p.type === "BinaryExpression"
        ) {
          n = p;
          p = n.parent;
          continue;
        }
        return false;
      }
      return false;
    };
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
        // Logical-fallback value: label={groupBy.label ?? 'Group by'} or
        // title={x || 'Untitled'} — the literal fallback is user-facing prose.
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          node.value.expression.type === "LogicalExpression" &&
          isUserStringExpr(node.value.expression)
        ) {
          context.report({
            node: node.value.expression,
            messageId: "attr",
            data: { attr: name, text: quote(userStringPreview(node.value.expression)) },
          });
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

      // User string reached via a LOCAL VARIABLE: a string (or ternary/logical of
      // strings) assigned to a const/let that is later rendered as a JSX child or
      // user attribute, e.g. FilterToolbar's
      //   const summary = n === 0 ? 'None' : n === len ? 'All' : `${n} selected`;
      //   …<span>{summary}</span>
      // The per-node JSX visitors never see the literal in `summary`, so we trace
      // the declaration to its rendered reference. Only flagged when a reference
      // is actually rendered — variables used purely in machine contexts
      // (className, ids, keys, fn args) are ignored.
      VariableDeclarator(node) {
        // Record `const [state, setState] = useState(...)` pairs so a prose
        // string/template handed directly to `setState(...)` can be traced to
        // `state`'s later render (see the CallExpression handler below).
        if (
          node.id.type === "ArrayPattern" &&
          node.id.elements.length >= 2 &&
          node.id.elements[0] &&
          node.id.elements[0].type === "Identifier" &&
          node.id.elements[1] &&
          node.id.elements[1].type === "Identifier" &&
          isUseStateCall(node.init)
        ) {
          const stateName = node.id.elements[0].name;
          const setterName = node.id.elements[1].name;
          const declared = sourceCode.getDeclaredVariables(node);
          const stateVar = declared.find((v) => v.name === stateName);
          if (stateVar) stateSetterPairs.set(setterName, stateVar);
        }

        if (!node.init || !isUserStringExpr(node.init) || !userStringHasProse(node.init)) {
          return;
        }
        const vars = sourceCode.getDeclaredVariables(node);
        for (const v of vars) {
          for (const ref of v.references) {
            // Skip the initializer write; only reads can be "rendered".
            if (ref.init || !ref.isRead()) continue;
            if (isRenderedUsage(ref.identifier)) {
              context.report({
                node: node.init,
                messageId: "variable",
                data: { name: v.name, text: quote(userStringPreview(node.init)) },
              });
              return;
            }
          }
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
        // State-setter sink: setX(<prose literal/template>) where `X` is the
        // state half of a `useState` pair that is later rendered, e.g.
        //   const [errorMsg, setErrorMsg] = useState<string>();
        //   setErrorMsg(`Hard-rule mismatch: ${dims.join(', ')}. Confirm to force-assign.`);
        //   … {errorMsg} …
        // Gated by the same prose heuristic as the variable-tracing check
        // above — `setStatus('pending')` (a machine token) is not flagged
        // even when `status` is rendered.
        if (calleeName && stateSetterPairs.has(calleeName)) {
          const arg = node.arguments[0];
          if (arg && isUserStringExpr(arg) && userStringHasProse(arg)) {
            const stateVar = stateSetterPairs.get(calleeName);
            const rendered = stateVar.references.some(
              (ref) => !ref.init && ref.isRead() && isRenderedUsage(ref.identifier),
            );
            if (rendered) {
              context.report({
                node: arg,
                messageId: "variable",
                data: { name: stateVar.name, text: quote(userStringPreview(arg)) },
              });
            }
          }
          return;
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
        // Bare-template form: toast(`Saved ${n} items`)
        if (arg && templateHasLetter(arg)) {
          context.report({
            node: arg,
            messageId: "toast",
            data: { text: quote(templatePreview(arg)) },
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
            } else if (templateHasLetter(prop.value)) {
              // Template-literal object-prop form: addToast({ message: `Saved ${n} items` })
              context.report({
                node: prop.value,
                messageId: "toast",
                data: { text: quote(templatePreview(prop.value)) },
              });
            }
          }
        }
      },
    };
  },
};

// alm/no-js-plural (spec 046 task #7). Flags JS-side pluralization:
//   - a ternary whose branches are a lone plural suffix and empty string, e.g.
//     `count !== 1 ? 's' : ''` (inline) or `{ suffix: n === 1 ? '' : 's' }` (param)
//   - the same suffix-or-empty shape written as a template literal, e.g.
//     `` n === 1 ? `` : `s` ``
//   - a short-circuit suffix, e.g. `count !== 1 && 's'`
//   - a ternary/if that picks between a `m.*_plural()` and `m.*_singular()`
//     catalog call based on a JS condition instead of a single count-selected
//     variant message
// This bakes English plural rules into code; the message catalog can't localize
// them. Use an inlang plural VARIANT message instead
// (declarations/selectors/match → Intl.PluralRules), called m.<key>({ count }).
/** @type {import('eslint').Rule.RuleModule} */
const noJsPlural = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JS-side pluralization (lone suffix ternaries, suffix short-circuits, paired plural/singular catalog calls); use an inlang plural variant message.",
    },
    schema: [],
    messages: {
      jsPlural:
        "JS-side pluralization {{text}} bakes English plural rules into code. Use an inlang plural variant message (declarations/selectors/match) called as m.<key>({ count }). If genuinely not a plural, add `// eslint-disable-next-line alm/no-js-plural -- <reason>`.",
      jsPluralPairedCall:
        "Picking between {{text}} with a JS condition bakes English plural rules into code. Merge them into a single inlang plural variant message (declarations/selectors/match) called as m.<key>({ count }). If genuinely not a plural, add `// eslint-disable-next-line alm/no-js-plural -- <reason>`.",
    },
  },
  create(context) {
    const PLURAL = new Set(["s", "es", "ies"]);

    /** String value of a Literal, or of a TemplateLiteral with no interpolation. */
    function staticStringValue(node) {
      if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
      }
      if (
        node.type === "TemplateLiteral" &&
        node.expressions.length === 0 &&
        node.quasis.length === 1
      ) {
        return node.quasis[0].value.cooked;
      }
      return undefined;
    }

    function isSuffixOrEmpty(node) {
      const v = staticStringValue(node);
      return v === "" || (v !== undefined && PLURAL.has(v));
    }

    function isPluralSuffix(node) {
      const v = staticStringValue(node);
      return v !== undefined && PLURAL.has(v);
    }

    /** `m.someKey(...)` call → the message key, else undefined. */
    function catalogCallKey(node) {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "m" &&
        node.callee.property.type === "Identifier"
      ) {
        return node.callee.property.name;
      }
      return undefined;
    }

    function reportSuffixTernary(node, branches) {
      const vals = branches.map((b) => staticStringValue(b) ?? "");
      context.report({
        node,
        messageId: "jsPlural",
        data: { text: `\`${vals.map((v) => v || "∅").join("/")}\`` },
      });
    }

    return {
      ConditionalExpression(node) {
        const branches = [node.consequent, node.alternate];

        // Case 1: lone plural-suffix-or-empty ternary (Literal or plain
        // TemplateLiteral), e.g. `n !== 1 ? 's' : ''`.
        if (
          branches.every(isSuffixOrEmpty) &&
          branches.some(isPluralSuffix)
        ) {
          reportSuffixTernary(node, branches);
          return;
        }

        // Case 2: paired `m.*_plural()` / `m.*_singular()` catalog calls
        // chosen via a JS condition instead of one variant message.
        const keys = branches.map(catalogCallKey);
        if (keys.every((k) => k !== undefined)) {
          const isPluralKey = (k) => /(^|_)plural$/i.test(k);
          const isSingularKey = (k) => /(^|_)singular$/i.test(k);
          const [keyA, keyB] = keys;
          if (
            (isPluralKey(keyA) && isSingularKey(keyB)) ||
            (isSingularKey(keyA) && isPluralKey(keyB))
          ) {
            context.report({
              node,
              messageId: "jsPluralPairedCall",
              data: { text: `\`m.${keyA}()\` / \`m.${keyB}()\`` },
            });
          }
        }
      },

      // Short-circuit suffix, e.g. `count !== 1 && 's'`.
      LogicalExpression(node) {
        if (node.operator !== "&&") return;
        if (isPluralSuffix(node.right)) {
          context.report({
            node,
            messageId: "jsPlural",
            data: { text: `\`${staticStringValue(node.right)}\`` },
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
