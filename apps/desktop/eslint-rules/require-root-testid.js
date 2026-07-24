// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ESLint rule: alm/require-root-testid
 *
 * Every EXPORTED React component's root JSX element must carry a data-testid
 * attribute, so e2e tests can locate it without coupling to CSS class names.
 *
 * Exemptions (detected automatically — no annotation needed):
 *   - Fragments (<> or <React.Fragment>) as the root — they are layout-only.
 *   - Components whose root element spreads `{...props}` or `{...rest}` (or
 *     any spread of an identifier that looks like a props bag: `...someProps`,
 *     `...ownProps`, `...labelRest`, `...buttonRest`) — the testid is provided
 *     by the caller via the spread.
 *   - Non-component exports (not PascalCase names, type/interface exports).
 *   - Default exports that are not named functions.
 *
 * Escape hatch for genuine exemptions:
 *   // eslint-disable-next-line alm/require-root-testid -- <reason>
 *
 * Baseline: check-eslint-baseline.mjs gates existing violations; this rule
 * is included in BASELINED_RULES so new violations (NOT in the baseline) fail
 * the build immediately while the existing debt drains over time.
 */

/** True when a JSX attribute is a spread that looks like a props passthrough. */
function isRestSpread(attr) {
  if (attr.type !== "JSXSpreadAttribute") return false;
  const arg = attr.argument;
  if (arg.type !== "Identifier") return false;
  // Heuristic: "rest", "props", anything ending in "Props", "Rest", "Attrs"
  return /^(rest|props|ownProps|[a-z]\w*(Props|Rest|Attrs))$/i.test(arg.name);
}

/** True when the JSX element is a fragment (bare or named). */
function isFragment(node) {
  if (node.type === "JSXFragment") return true;
  if (node.type !== "JSXElement") return false;
  const name = node.openingElement.name;
  if (name.type === "JSXIdentifier" && name.name === "Fragment") return true;
  // React.Fragment
  if (
    name.type === "JSXMemberExpression" &&
    name.object.type === "JSXIdentifier" &&
    name.object.name === "React" &&
    name.property.type === "JSXIdentifier" &&
    name.property.name === "Fragment"
  )
    return true;
  return false;
}

/** True when the JSX element already carries data-testid. */
function hasTestId(jsxElement) {
  if (jsxElement.type !== "JSXElement") return false;
  return jsxElement.openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === "data-testid",
  );
}

/** True when the JSX element spreads a rest/props bag (testid from caller). */
function spreadsProps(jsxElement) {
  if (jsxElement.type !== "JSXElement") return false;
  return jsxElement.openingElement.attributes.some(isRestSpread);
}

/** Walk a function body to find the first returned JSX node. */
function firstReturnedJsx(body) {
  if (!body) return null;
  // Arrow function with expression body: `() => <Foo />`
  if (body.type === "JSXElement" || body.type === "JSXFragment") return body;
  // Block body: search for return statements
  if (body.type === "BlockStatement") {
    for (const stmt of body.body) {
      const jsx = findReturnJsx(stmt);
      if (jsx) return jsx;
    }
  }
  return null;
}

function findReturnJsx(node) {
  if (!node) return null;
  if (node.type === "ReturnStatement") {
    const arg = node.argument;
    if (!arg) return null;
    if (arg.type === "JSXElement" || arg.type === "JSXFragment") return arg;
    // `return condition ? <A> : <B>` — check both branches
    if (arg.type === "ConditionalExpression") {
      return (
        findReturnJsx({ type: "ReturnStatement", argument: arg.consequent }) ??
        findReturnJsx({ type: "ReturnStatement", argument: arg.alternate })
      );
    }
    // `return (\n  <Foo />\n)` — parenthesized
    return null;
  }
  if (node.type === "IfStatement") {
    return (
      findReturnJsx(node.consequent) ?? findReturnJsx(node.alternate)
    );
  }
  if (node.type === "BlockStatement") {
    for (const stmt of node.body) {
      const jsx = findReturnJsx(stmt);
      if (jsx) return jsx;
    }
  }
  return null;
}

/** True when `name` looks like a React component (PascalCase). */
function isPascalCase(name) {
  return /^[A-Z]/.test(name);
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Exported React components must have data-testid on their root JSX element.",
    },
    schema: [],
    messages: {
      missingTestId:
        "Exported component '{{name}}' root JSX element is missing data-testid. Add data-testid=\"{{testid}}\" or spread {{...rest}} to receive it from the caller.",
    },
  },

  create(context) {
    /**
     * Check a component's root JSX. Reports if:
     *   - The root is a real JSX element (not a fragment)
     *   - It doesn't have data-testid
     *   - It doesn't spread a props/rest bag
     */
    function checkComponent(name, bodyNode) {
      const jsx = firstReturnedJsx(bodyNode);
      if (!jsx) return; // no JSX found — not a component, skip
      if (isFragment(jsx)) return; // fragment root: caller provides testid
      if (jsx.type !== "JSXElement") return;
      if (spreadsProps(jsx)) return; // rest spread: testid comes from caller
      if (hasTestId(jsx)) return; // already has it
      // Generate a suggested testid from the component name (kebab-case)
      const suggested = name
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .toLowerCase();
      context.report({
        node: jsx.openingElement,
        messageId: "missingTestId",
        data: { name, testid: suggested },
      });
    }

    return {
      // `export function MyComponent(...) { return <...> }`
      ExportNamedDeclaration(node) {
        const decl = node.declaration;
        if (!decl) return;
        if (
          decl.type === "FunctionDeclaration" &&
          decl.id &&
          isPascalCase(decl.id.name)
        ) {
          checkComponent(decl.id.name, decl.body);
        }
        if (decl.type === "VariableDeclaration") {
          for (const declarator of decl.declarations) {
            if (
              declarator.id.type === "Identifier" &&
              isPascalCase(declarator.id.name) &&
              declarator.init
            ) {
              const init = declarator.init;
              // `export const Foo = () => <...>` or `= function() {...}`
              if (
                init.type === "ArrowFunctionExpression" ||
                init.type === "FunctionExpression"
              ) {
                checkComponent(declarator.id.name, init.body);
              }
              // `export const Foo = React.forwardRef(...)` — skip (checked via body)
              if (
                init.type === "CallExpression" &&
                init.arguments.length > 0
              ) {
                const cb = init.arguments[0];
                if (
                  cb.type === "ArrowFunctionExpression" ||
                  cb.type === "FunctionExpression"
                ) {
                  checkComponent(declarator.id.name, cb.body);
                }
              }
            }
          }
        }
      },

      // `export default function MyComponent() { ... }`
      ExportDefaultDeclaration(node) {
        const decl = node.declaration;
        if (
          decl.type === "FunctionDeclaration" &&
          decl.id &&
          isPascalCase(decl.id.name)
        ) {
          checkComponent(decl.id.name, decl.body);
        }
      },
    };
  },
};

export default {
  rules: {
    "require-root-testid": rule,
  },
};
