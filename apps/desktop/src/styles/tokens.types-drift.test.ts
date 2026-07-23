// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * tokens.types-drift.test.ts — #1191 follow-up.
 *
 * `tokens.d.ts` is generated from `tokens.css` (+ `packages/tokens/tokens-docs.css`)
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
  '../../packages/tokens/tokens-docs.css',
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

/**
 * Properties the extractor got for free while it scanned emitted CSS, and which
 * become assumptions the moment anyone enumerates the token tree instead.
 * Pinned so that refactor fails loudly rather than shipping a type quietly
 * missing names.
 */
describe('extractTokenNames covers the union, not one representative block', () => {
  it('includes a token declared only in a non-default theme block', () => {
    const css = `
      :root { --pv-shared: #000; }
      :root,
      [data-theme="warm-slate"] { --pv-shared: #000; }
      [data-theme="observatory-cool"] { --pv-shared: #fff; --pv-dark-only: #123456; }
    `;
    // Resolving the default theme alone would miss --pv-dark-only entirely: it
    // would ship in the CSS and be absent from the type.
    expect(extractTokenNames([css])).toContain('pv-dark-only');
  });

  it('does not drop tokens containing uppercase or underscore', () => {
    // A narrower [a-z0-9-] class fails OPEN — the token ships in the CSS and is
    // silently absent from the type, so a typo at a call site still compiles.
    const css = ':root { --pv-legacyName: 1px; --pv-snake_case: 2px; }';
    expect(extractTokenNames([css])).toEqual([
      'pv-legacyName',
      'pv-snake_case',
    ]);
  });
});
