// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Checklist tooltip contract — WCAG 1.4.13 (Content on Hover or Focus).
 *
 * WHY THIS EXISTS: this tooltip was hand-rolled twice and was non-conformant
 * both times.
 *
 *  1. Pure CSS (`:hover, :focus-within { visibility: visible }`). Rows contain
 *     buttons, so clicking one left `:focus-within` true and pinned the tooltip
 *     open after the pointer had left — and CSS cannot honour Escape at all, so
 *     "Dismissable" was simply unimplementable.
 *  2. Local React state (hover + `:focus-visible` + an Escape listener). That
 *     fixed the pinning and Escape, but had no delay, no positioning and no
 *     safe-polygon path to the popup, so "Hoverable" was still shaky and it
 *     felt cheap.
 *
 * The third implementation delegates to the shared `Tooltip` primitive, which
 * satisfies all three 1.4.13 requirements via base-ui:
 *   - Dismissable — `TooltipRoot` wires `useDismiss` (escapeKey).
 *   - Hoverable   — `useHover` + `safePolygon` keep it open while the pointer
 *                   travels to the popup.
 *   - Persistent  — `closeDelay`; it never hides on a timer.
 *
 * So the conformance guard is "we still delegate": if someone reintroduces a
 * bespoke reveal here, the criterion silently regresses with no visual clue and
 * no failing test elsewhere. That is exactly what happened twice.
 *
 * Source-level on purpose: jsdom does not lay out or portal base-ui's popup
 * faithfully, so an interaction assertion here would pass vacuously and rebuild
 * the blind spot it is meant to close.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const source = readFileSync(join(__dirname, 'ChecklistSection.tsx'), 'utf8');

/**
 * Source with comments stripped. The component documents the two previous
 * non-conformant implementations by name, so matching the raw file would flag
 * its own history as a regression.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('checklist tooltip — WCAG 1.4.13 conformance contract', () => {
  it('uses the shared Tooltip primitive', () => {
    expect(source).toMatch(/import \{ Tooltip \} from '@\/ui'/);
    expect(source).toMatch(/<Tooltip\b/);
  });

  it('feeds the tooltip the item copy', () => {
    expect(source).toMatch(/<Tooltip[^>]*content=\{itemTooltip\(/s);
  });

  it('does not hand-roll the reveal again', () => {
    // The two previous non-conformant implementations, in their exact shapes.
    expect(code).not.toMatch(/:focus-within/);
    expect(code).not.toMatch(/data-open=/);
    expect(code).not.toMatch(/key === 'Escape'/);
    expect(code).not.toMatch(/role="tooltip"/);
  });
});
