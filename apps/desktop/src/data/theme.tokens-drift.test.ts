// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * theme.tokens-drift.test.ts — #587 follow-up.
 *
 * `theme.ts` hardcodes SPACING_BASE_PX / TEXT_SCALE_BASE_PX as duplicates of
 * the `--pv-sp-*` / `--pv-text-*` base px values in
 * packages/tokens/foundation.css (jsdom can't reliably resolve stylesheet
 * custom properties via getComputedStyle, so applyTokenScale reads these
 * tables instead of the stylesheet). Nothing else enforces that the two stay
 * in sync — this test parses foundation.css directly and fails if a value
 * drifts, so a future edit can't silently desync the runtime scaling.
 * `--pv-row-height` stays app-local (tokens.css), unaffected by handoff 04.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROW_HEIGHT_PX, SPACING_BASE_PX, TEXT_SCALE_BASE_PX } from './theme';

// vitest's `css: false` test config replaces all `.css`-suffixed imports
// (including `?raw`) with an empty string, so this reads the files directly
// instead. vitest runs with cwd = apps/desktop (see package.json `test`).
const tokensCssPath = join(process.cwd(), 'src/styles/tokens.css');
const foundationCssPath = join(
  process.cwd(),
  '../../packages/tokens/foundation.css',
);

/**
 * Parses the base `:root { ... }` block only. Anchored to the bare `:root`
 * selector: theme blocks use `[data-theme=...]` and the shared default-palette
 * block uses `:root, [data-theme=...]`, so neither matches `:root\s*{`. CSS
 * blocks here never nest, so `[^}]*` spans exactly one block.
 */
function parseRootTokenPx(
  cssPath: string,
  varPrefix: string,
): Record<string, number> {
  const css = readFileSync(cssPath, 'utf-8');
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  if (rootBlock === undefined) throw new Error(`no :root block in ${cssPath}`);
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

/**
 * Parses the `--pv-text-*` rem declarations out of foundation.css's `:root`
 * block and converts back to px-at-the-14px-default-root, rounded to the
 * nearest integer — the same numbers `TEXT_SCALE_BASE_PX` (theme.ts)
 * hardcodes for the per-dial-stop rounding guard (spec 055 T010/T011).
 * foundation.css declares these as rem (not px) so the type scale resolves
 * against whatever root font-size the font-size setting writes.
 */
function parseRootTextTokenRemAsPx(): Record<string, number> {
  const css = readFileSync(foundationCssPath, 'utf-8');
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  if (rootBlock === undefined)
    throw new Error(`no :root block in ${foundationCssPath}`);
  const pattern = /(--pv-text-[\w-]+):\s*(\d+(?:\.\d+)?)rem;/g;
  const result: Record<string, number> = {};
  for (const match of rootBlock.matchAll(pattern)) {
    result[match[1]] = Math.round(Number(match[2]) * 14);
  }
  return result;
}

/** Parses the `--pv-row-height: <n>px;` declaration out of a CSS block's body. */
function parseRowHeightPx(block: string, blockLabel: string): number {
  const match = /--pv-row-height:\s*(\d+(?:\.\d+)?)px;/.exec(block);
  if (!match) throw new Error(`no --pv-row-height in ${blockLabel} block`);
  return Number(match[1]);
}

/** Parses a single `<selector> { ...--pv-row-height: <n>px...; }` block's value. */
function parseSelectorRowHeightPx(selector: string): number {
  const css = readFileSync(tokensCssPath, 'utf-8');
  const escaped = selector.replace(/[.]/g, '\\.');
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (block === undefined)
    throw new Error(`no ${selector} block in tokens.css`);
  return parseRowHeightPx(block, selector);
}

describe('theme.ts token-scale base tables match tokens.css / foundation.css :root', () => {
  it('SPACING_BASE_PX matches --pv-sp-* base px values', () => {
    const fromCss = parseRootTokenPx(foundationCssPath, '--pv-sp-');
    expect(Object.keys(fromCss).length).toBeGreaterThan(0);
    expect(SPACING_BASE_PX).toEqual(fromCss);
  });

  it('TEXT_SCALE_BASE_PX matches --pv-text-* rem values (converted @ 14px root)', () => {
    const fromCss = parseRootTextTokenRemAsPx();
    expect(Object.keys(fromCss).length).toBeGreaterThan(0);
    expect(TEXT_SCALE_BASE_PX).toEqual(fromCss);
  });

  it('ROW_HEIGHT_PX matches --pv-row-height across density selectors', () => {
    const css = readFileSync(tokensCssPath, 'utf-8');
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
    if (rootBlock === undefined)
      throw new Error('no :root block in tokens.css');
    const fromCss = {
      comfortable: parseRowHeightPx(rootBlock, ':root'),
      compact: parseSelectorRowHeightPx('.density-compact'),
      spacious: parseSelectorRowHeightPx('.density-spacious'),
    };
    expect(ROW_HEIGHT_PX).toEqual(fromCss);
  });
});
