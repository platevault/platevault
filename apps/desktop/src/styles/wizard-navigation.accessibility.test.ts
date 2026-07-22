// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'src/styles/components/wizard-steps.css'),
  'utf-8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsFor(selector: string): Set<string> {
  const declarations = new Set<string>();
  for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').some((item) => item.trim() === selector)) {
      continue;
    }
    for (const declaration of body.split(';')) {
      const [property, ...value] = declaration.split(':');
      if (property.trim() && value.length > 0) {
        declarations.add(`${property.trim()}:${value.join(':').trim()}`);
      }
    }
  }
  return declarations;
}

describe('wizard progress accessibility CSS', () => {
  it('draws the shared box-shadow focus token on progress buttons', () => {
    const focus = declarationsFor('button.pv-wizard__steps-card:focus-visible');
    expect(focus).toContain('outline:none');
    expect(focus).toContain('box-shadow:var(--pv-focus-ring)');
    expect([...focus].join(';')).not.toContain(
      'outline:2px solid var(--pv-focus-ring)',
    );
  });

  it('keeps both progress rails scrollable on one axis at reflow widths', () => {
    for (const selector of ['.pv-wizard__rail', '.pv-wizard__steps-bar']) {
      const declarations = declarationsFor(selector);
      expect(declarations).toContain('overflow-x:auto');
      expect(declarations).toContain('overflow-y:hidden');
    }
    expect(declarationsFor('.pv-wizard__steps-card')).toContain(
      'min-width:max-content',
    );
  });

  it('reserves space inside the scrollport for the two-pixel focus ring', () => {
    const bar = declarationsFor('.pv-wizard__steps-bar');
    expect(bar).toContain('padding:2px');
    expect(bar).toContain('scroll-padding-inline:2px');
  });

  it('styles every display-only progress state through data attributes', () => {
    for (const state of ['active', 'completed', 'pending']) {
      expect(
        declarationsFor(
          `.pv-wizard__step[data-state='${state}'] .pv-wizard__step-badge`,
        ).size,
      ).toBeGreaterThan(0);
    }
  });
});
