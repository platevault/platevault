// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ESLint rule: alm/no-vacuous-waitfor (issue #1136, from the #1083 sweep).
 *
 * Flags negated mock-call assertions inside a `waitFor` callback.
 *
 * Mock call counts are monotonically non-decreasing: once a mock has been
 * called it never becomes un-called. So a NEGATED call assertion is either
 * already true on `waitFor`'s first attempt — which returns immediately,
 * asserting nothing — or already false and never able to recover. Either way
 * the wrapper cannot do the job it looks like it is doing, and it silently
 * converts a real regression test into a no-op.
 *
 * This is the shape a naive "fix the flake by wrapping it in waitFor" edit
 * introduces. Two real examples the sweep deliberately left synchronous:
 * `AuditLog.test.tsx` asserts a keystroke did NOT trigger an immediate IPC
 * round-trip, and `SchemaViewer.callVersion.test.tsx` guards against an extra
 * re-fetch. Wrapping either would have destroyed exactly the guarantee under
 * test while still going green.
 *
 * NOT flagged, because they are legitimate and monotonic — the awaited
 * condition becomes true as calls arrive:
 *   await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
 *   await waitFor(() => expect(mock).toHaveBeenCalledWith({ to: '/setup' }));
 * The second is the actual fix applied in PR #1128 (`SetupWizard.test.tsx`),
 * so a rule that banned call-count matchers outright would reject the fix.
 *
 * Negated DOM assertions such as `expect(el).not.toBeInTheDocument()` are also
 * NOT flagged: the DOM is not monotonic, and waiting for removal is the
 * documented Testing Library idiom.
 */

/**
 * Mock/spy matchers whose subject only ever accumulates. Negating any of them
 * yields a condition that `waitFor` cannot meaningfully poll for.
 */
const MONOTONIC_CALL_MATCHERS = new Set([
  'toHaveBeenCalled',
  'toHaveBeenCalledOnce',
  'toHaveBeenCalledTimes',
  'toHaveBeenCalledWith',
  'toHaveBeenLastCalledWith',
  'toHaveBeenNthCalledWith',
  'toHaveReturned',
  'toHaveReturnedTimes',
  'toHaveReturnedWith',
]);

/** `waitFor(cb)` and `vi.waitFor(cb)` / `screen.waitFor(cb)` alike. */
function isWaitForCall(node) {
  if (node.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'waitFor';
  return (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'waitFor'
  );
}

/**
 * True when `node` is a matcher chain rooted at `expect(...)` that passes
 * through a `.not` modifier. Walking the chain (rather than checking the
 * immediate parent) keeps `.resolves.not.` and `.not.resolves.` working.
 */
function isNegatedExpectChain(node) {
  let current = node;
  let negated = false;
  while (current.type === 'MemberExpression') {
    if (
      current.property.type === 'Identifier' &&
      current.property.name === 'not'
    ) {
      negated = true;
    }
    current = current.object;
  }
  return (
    negated &&
    current.type === 'CallExpression' &&
    current.callee.type === 'Identifier' &&
    current.callee.name === 'expect'
  );
}

/**
 * The real containment check. Returns the enclosing `waitFor` call only when
 * `node` sits inside its CALLBACK argument, not merely near it in the source.
 * Line-proximity matching is what produced 11 of 14 false positives in the
 * original #1083 sweep (issue #1136).
 */
function enclosingWaitForCallback(ancestors, node) {
  for (let i = 0; i < ancestors.length; i += 1) {
    const ancestor = ancestors[i];
    if (!isWaitForCall(ancestor)) continue;
    const childOnPath = i + 1 < ancestors.length ? ancestors[i + 1] : node;
    if (ancestor.arguments[0] === childOnPath) return ancestor;
  }
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow negated mock-call assertions inside a waitFor callback, which pass vacuously on the first attempt.',
    },
    schema: [],
    messages: {
      vacuous:
        '`expect(...).not.{{matcher}}()` inside `waitFor` asserts nothing: call counts only increase, so this passes on the first attempt. Assert it synchronously instead, after awaiting whatever observable proves the work is done. See docs/development/testing.md.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          !MONOTONIC_CALL_MATCHERS.has(callee.property.name)
        ) {
          return;
        }
        if (!isNegatedExpectChain(callee.object)) return;

        const ancestors = context.sourceCode.getAncestors(node);
        if (!enclosingWaitForCallback(ancestors, node)) return;

        context.report({
          node,
          messageId: 'vacuous',
          data: { matcher: callee.property.name },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-vacuous-waitfor': rule,
  },
};
