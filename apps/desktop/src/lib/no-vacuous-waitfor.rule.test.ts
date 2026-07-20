// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
// The local ESLint rule guarding against vacuous waitFor wrappers (issue #1136).
import plugin from '../../eslint-rules/no-vacuous-waitfor.js';

function lint(code: string) {
  const linter = new Linter();
  return linter
    .verify(code, {
      plugins: { alm: plugin },
      languageOptions: {
        parserOptions: {
          ecmaFeatures: { jsx: true },
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
      },
      rules: { 'alm/no-vacuous-waitfor': 'error' },
    })
    .filter((m) => m.ruleId === 'alm/no-vacuous-waitfor');
}

describe('alm/no-vacuous-waitfor', () => {
  it('flags negated mock-call assertions inside a waitFor callback', () => {
    expect(
      lint('await waitFor(() => { expect(mockIpc).not.toHaveBeenCalled(); });'),
    ).toHaveLength(1);
    expect(
      lint('await waitFor(() => expect(m).not.toHaveBeenCalledWith(1));'),
    ).toHaveLength(1);
    expect(
      lint('await waitFor(() => expect(m).not.toHaveBeenCalledTimes(2));'),
    ).toHaveLength(1);
    // Buried among sibling assertions in a block body.
    expect(
      lint(
        'await waitFor(() => { expect(a).toBeTruthy(); expect(m).not.toHaveBeenCalled(); });',
      ),
    ).toHaveLength(1);
    // `vi.waitFor` is the same trap.
    expect(
      lint('await vi.waitFor(() => expect(m).not.toHaveBeenCalled());'),
    ).toHaveLength(1);
  });

  it('leaves the correct fixes from PR #1128 alone', () => {
    // Waiting for a call to ARRIVE is monotonic and legitimate. A rule that
    // banned call-count matchers outright would reject the real fix.
    expect(
      lint(
        'await waitFor(() => expect(mockFirstrunComplete).toHaveBeenCalledTimes(1));',
      ),
    ).toHaveLength(0);
    expect(
      lint(
        "await waitFor(() => { expect(mockNavigate).toHaveBeenCalledWith({ to: '/setup' }); });",
      ),
    ).toHaveLength(0);
  });

  it('leaves correctly-synchronous negative assertions alone', () => {
    // The AuditLog/SchemaViewer shape: the guarantee is "no extra call ever
    // arrives", asserted synchronously after an unrelated await. Outside the
    // callback, so not vacuous.
    expect(
      lint(
        'await waitFor(() => expect(x).toBeTruthy());\nexpect(mockIpc).not.toHaveBeenCalled();',
      ),
    ).toHaveLength(0);
  });

  it('does not flag negated DOM assertions, which are not monotonic', () => {
    expect(
      lint('await waitFor(() => { expect(el).not.toBeInTheDocument(); });'),
    ).toHaveLength(0);
  });

  it('requires real containment, not line proximity', () => {
    // The defect that produced 11 of 14 false positives in the original sweep:
    // a matcher whose own `waitFor(` merely sits on a nearby line.
    expect(
      lint(
        'await waitFor(() =>\n  expect(mockX).toHaveBeenCalledWith({ id: 1 }),\n);',
      ),
    ).toHaveLength(0);
    // A negated assertion AFTER the waitFor block, not inside it.
    expect(
      lint(
        'await waitFor(() => {\n  expect(a).toBeTruthy();\n});\nexpect(m).not.toHaveBeenCalled();',
      ),
    ).toHaveLength(0);
    // A negated assertion inside a callback passed to something else entirely.
    expect(
      lint('act(() => { expect(m).not.toHaveBeenCalled(); });'),
    ).toHaveLength(0);
  });

  it('ignores negated chains that are not rooted at expect()', () => {
    expect(
      lint('await waitFor(() => { assert(m).not.toHaveBeenCalled(); });'),
    ).toHaveLength(0);
  });
});
