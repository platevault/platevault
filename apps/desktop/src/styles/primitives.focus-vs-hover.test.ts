// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * primitives.focus-vs-hover.test.ts — astro-plan-5ri.
 *
 * `.pv-info-tip` once declared `:hover` and `:focus-visible` in a single
 * shared block that set `outline: none` and recoloured the border and text,
 * so keyboard focus rendered identically to pointer hover — a focus indicator
 * that exists but conveys nothing (WCAG 2.4.7, 2.4.11). `.pv-lock` had no rule
 * at all and fell back to the UA default.
 *
 * Asserting merely that a focus style exists would have passed on both of
 * those. This asserts the property the defect violated: the `:focus-visible`
 * declarations must differ from the `:hover` declarations, and must carry the
 * shared `--pv-focus-ring` indicator that hover does not.
 *
 * It reads the CSS sources directly because vitest runs with `css: false`,
 * which replaces `.css` imports with an empty string (see
 * tokens.types-drift.test.ts). vitest runs with cwd = apps/desktop.
 */

/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentsDir = join(process.cwd(), 'src/styles/components');

/** Every bundled component stylesheet, so a rule reintroduced in any file is
 *  caught rather than only one the fix happened to touch. */
function readAllComponentCss(): string {
  return readdirSync(componentsDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(componentsDir, f), 'utf-8'))
    .join('\n');
}

/**
 * Declarations that apply to `selector`, as normalised `prop:value` strings.
 *
 * The rule regex cannot span a nested block, so an `@media` wrapper simply
 * fails to match and the inner rules match on the next scan position.
 */
function declarationsFor(css: string, selector: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = new Set<string>();

  for (const [, selectorList, body] of withoutComments.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const matches = selectorList.split(',').some((s) => s.trim() === selector);
    if (!matches) continue;

    for (const decl of body.split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (rest.length === 0) continue;
      const normalised = `${prop.trim()}:${rest.join(':').trim()}`;
      if (prop.trim()) decls.add(normalised);
    }
  }
  return decls;
}

const triggers = ['.pv-info-tip', '.pv-lock'];

describe('tooltip trigger focus indicators are distinguishable from hover', () => {
  for (const base of triggers) {
    it(`${base}:focus-visible declares something ${base}:hover does not`, () => {
      const css = readAllComponentCss();
      const focus = declarationsFor(css, `${base}:focus-visible`);
      const hover = declarationsFor(css, `${base}:hover`);

      expect(
        focus.size,
        `${base}:focus-visible has no declarations — keyboard focus falls back to the UA default`,
      ).toBeGreaterThan(0);

      const distinguishing = [...focus].filter((d) => !hover.has(d));
      expect(
        distinguishing,
        `${base}:focus-visible is indistinguishable from ${base}:hover — every focus declaration is also a hover declaration`,
      ).not.toHaveLength(0);
    });

    it(`${base} draws the shared focus ring and ${base}:hover does not`, () => {
      const css = readAllComponentCss();
      const focus = declarationsFor(css, `${base}:focus-visible`);
      const hover = declarationsFor(css, `${base}:hover`);

      expect(
        focus.has('box-shadow:var(--pv-focus-ring)'),
        `${base}:focus-visible must use the shared --pv-focus-ring token`,
      ).toBe(true);

      // If hover ever adopts the ring the two states collapse again, which is
      // the original defect wearing a different declaration.
      expect(
        hover.has('box-shadow:var(--pv-focus-ring)'),
        `${base}:hover must not draw the focus ring`,
      ).toBe(false);
    });
  }
});
