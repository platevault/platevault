// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Orientation-walk tooltip styling contract (spec 056, US1).
 *
 * WHY THIS EXISTS: the walk tooltip shipped completely unstyled — bare text
 * over the dim overlay with OS-default buttons — and every gate stayed green.
 * The adapter deliberately does not spread joyride's `tooltipProps` (VC-002
 * forbids the `role="alertdialog"` it carries), which also forfeits joyride's
 * default tooltip CSS, and no stylesheet defined `.pv-onboarding-tooltip`.
 * The Layer-2 journey only ever asserted the element EXISTS
 * (`querySelector('.pv-onboarding-tooltip')`), which is true of an unstyled
 * node, so nothing failed. Verified on real Windows/WebView2: 0 of 1868 loaded
 * CSS rules matched the tooltip family.
 *
 * These are source-level assertions on purpose: jsdom does not resolve the
 * `import './walk.css'` side effect into applied computed styles, so asserting
 * `getComputedStyle(...).background` here would pass vacuously and rebuild the
 * exact blind spot this test closes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const DIR = join(__dirname);
const css = readFileSync(join(DIR, 'walk.css'), 'utf8');
const adapter = readFileSync(join(DIR, 'joyrideAdapter.tsx'), 'utf8');

describe('orientation walk tooltip styling contract', () => {
  it('defines a card rule for the tooltip root', () => {
    expect(css).toMatch(/\.pv-onboarding-tooltip\s*\{/);
  });

  it('gives the card a real surface — background, padding and border', () => {
    const card = /\.pv-onboarding-tooltip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(card).toMatch(/background:/);
    expect(card).toMatch(/padding:/);
    expect(card).toMatch(/border:/);
  });

  it('is imported by the adapter that renders the tooltip', () => {
    expect(adapter).toMatch(/import\s+'\.\/walk\.css'/);
  });

  it('uses tokens, never raw colour literals', () => {
    // Raw hex/rgb in this file would bypass the theme system (4 themes).
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it('reuses the shared Btn primitive instead of restyling buttons', () => {
    // The one-component/one-class rule: no per-feature button CSS clone.
    expect(css).not.toMatch(
      /\.pv-onboarding-tooltip__(skip|back|primary|close)\s*\{/,
    );
    expect(adapter).toMatch(/<Btn/);
  });

  it('keeps the class names the Layer-2 journey selects on', () => {
    for (const cls of ['__skip', '__primary']) {
      expect(adapter).toContain(`pv-onboarding-tooltip${cls}`);
    }
  });

  it('keeps data-action="primary" for the focus-trap autofocus', () => {
    expect(adapter).toMatch(/data-action="primary"/);
  });
});
