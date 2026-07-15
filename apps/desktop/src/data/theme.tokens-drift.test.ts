// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * theme.tokens-drift.test.ts — #587 follow-up.
 *
 * `theme.ts` hardcodes SPACING_BASE_PX / TEXT_SCALE_BASE_PX as duplicates of
 * the `--alm-sp-*` / `--alm-text-*` base px values in tokens.css (jsdom can't
 * reliably resolve stylesheet custom properties via getComputedStyle, so
 * applyTokenScale reads these tables instead of the stylesheet). Nothing else
 * enforces that the two stay in sync — this test parses tokens.css directly
 * and fails if a value drifts, so a future tokens.css edit can't silently
 * desync the runtime scaling.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACING_BASE_PX, TEXT_SCALE_BASE_PX } from './theme';

// vitest's `css: false` test config replaces all `.css`-suffixed imports
// (including `?raw`) with an empty string, so this reads the file directly
// instead. vitest runs with cwd = apps/desktop (see package.json `test`).
const tokensCssPath = join(process.cwd(), 'src/styles/tokens.css');

/** Parses only the base `:root { ... }` block, before any `[data-theme]` override block. */
function parseRootTokenPx(varPrefix: string): Record<string, number> {
  const css = readFileSync(tokensCssPath, 'utf-8');
  const rootBlockEnd = css.indexOf('\n}');
  const rootBlock = css.slice(0, rootBlockEnd);
  const pattern = new RegExp(
    `(${varPrefix}[\\w-]+):\\s*(\\d+(?:\\.\\d+)?)px;`,
    'g',
  );
  const result: Record<string, number> = {};
  for (const match of rootBlock.matchAll(pattern)) {
    result[match[1]] = Number(match[2]);
  }
  return result;
}

describe('theme.ts token-scale base tables match tokens.css :root', () => {
  it('SPACING_BASE_PX matches --alm-sp-* base px values', () => {
    const fromCss = parseRootTokenPx('--alm-sp-');
    expect(Object.keys(fromCss).length).toBeGreaterThan(0);
    expect(SPACING_BASE_PX).toEqual(fromCss);
  });

  it('TEXT_SCALE_BASE_PX matches --alm-text-* base px values', () => {
    const fromCss = parseRootTokenPx('--alm-text-');
    expect(Object.keys(fromCss).length).toBeGreaterThan(0);
    expect(TEXT_SCALE_BASE_PX).toEqual(fromCss);
  });
});
