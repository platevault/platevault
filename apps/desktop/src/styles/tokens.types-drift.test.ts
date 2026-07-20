// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * tokens.types-drift.test.ts — #1191 follow-up.
 *
 * `tokens.d.ts` is generated from `tokens.css` (+ `packages/tokens/foundation.css`)
 * by `scripts/gen-token-types.mjs`, wired only as the `tokens:types` package
 * script. Nothing enforces that a `tokens.css` edit is followed by
 * regeneration — a branch once added tokens to `tokens.css` without
 * regenerating `tokens.d.ts` and nothing failed; it was caught by hand.
 *
 * This test imports the generator's own parsing/rendering functions (not a
 * duplicate of its rules — see gen-token-types.mjs) and asserts their output
 * against the committed `tokens.css` matches the committed `tokens.d.ts`
 * byte-for-byte.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractTokenNames,
  renderTokenTypesDts,
} from '../../scripts/gen-token-types.mjs';

// vitest's `css: false` test config replaces all `.css`-suffixed imports with
// an empty string, so this reads the source files directly instead, exactly
// like theme.tokens-drift.test.ts. vitest runs with cwd = apps/desktop.
const tokensCssPath = join(process.cwd(), 'src/styles/tokens.css');
const foundationCssPath = join(
  process.cwd(),
  '../../packages/tokens/foundation.css',
);
const tokensDtsPath = join(process.cwd(), 'src/styles/tokens.d.ts');

describe('tokens.d.ts matches tokens.css / foundation.css', () => {
  it('committed tokens.d.ts is what the generator would produce right now', () => {
    const cssTexts = [
      readFileSync(tokensCssPath, 'utf-8'),
      readFileSync(foundationCssPath, 'utf-8'),
    ];
    const sortedNames = extractTokenNames(cssTexts);
    expect(sortedNames.length).toBeGreaterThan(0);

    const expected = renderTokenTypesDts(sortedNames);
    const actual = readFileSync(tokensDtsPath, 'utf-8');

    expect(
      actual,
      'tokens.d.ts is out of sync with tokens.css / foundation.css — run `pnpm tokens:types` and commit the result.',
    ).toBe(expected);
  });
});
