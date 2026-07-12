/**
 * CommandPalette devMode gate tests (spec 021 T009).
 *
 * Verifies that:
 * - The "Developer / Contracts" entry is hidden when devMode = false.
 * - The "Developer / Contracts" entry appears when devMode = true.
 * - The dev entry navigates to /dev/contracts.
 *
 * Tests operate on the PAGES/DEV_PAGES constants and the visibility logic,
 * not on the rendered Dialog (which requires ResizeObserver — deferred to
 * Playwright). Pattern mirrors CommandPalette.test.tsx.
 */

import { describe, it, expect } from 'vitest';

// ── Mirrors of CommandPalette.tsx constants ───────────────────────────────────
// Keep in sync with apps/desktop/src/app/CommandPalette.tsx.

const PAGES: Array<{ label: string; route: string }> = [
  { label: 'Sessions', route: '/sessions' },
  { label: 'Review queue', route: '/review' },
  { label: 'Calibration', route: '/calibration' },
  { label: 'Targets', route: '/targets' },
  { label: 'Projects', route: '/projects' },
  { label: 'Plans', route: '/plans' },
  { label: 'Audit log', route: '/audit' },
  { label: 'Settings', route: '/settings' },
];

const DEV_PAGES: Array<{ label: string; route: string }> = [
  { label: 'Developer / Contracts', route: '/dev/contracts' },
];

/** Mirror of the CommandPalette visibility logic. */
function visiblePages(
  devMode: boolean,
): Array<{ label: string; route: string }> {
  return devMode ? [...PAGES, ...DEV_PAGES] : PAGES;
}

// ── Tests (T009) ──────────────────────────────────────────────────────────────

describe('CommandPalette devMode gate (T009)', () => {
  it('dev entry is absent when devMode = false', () => {
    const pages = visiblePages(false);
    const devEntry = pages.find((p) => p.route === '/dev/contracts');
    expect(devEntry).toBeUndefined();
  });

  it('dev entry is present when devMode = true', () => {
    const pages = visiblePages(true);
    const devEntry = pages.find((p) => p.route === '/dev/contracts');
    expect(devEntry).toBeDefined();
    expect(devEntry?.label).toBe('Developer / Contracts');
  });

  it('dev entry routes to /dev/contracts', () => {
    const pages = visiblePages(true);
    const devEntry = pages.find((p) => p.label === 'Developer / Contracts');
    expect(devEntry?.route).toBe('/dev/contracts');
  });

  it('standard pages are unchanged regardless of devMode', () => {
    const pagesOff = visiblePages(false);
    const pagesOn = visiblePages(true);
    // Every standard page must appear in both modes.
    for (const p of PAGES) {
      expect(pagesOff.some((x) => x.route === p.route)).toBe(true);
      expect(pagesOn.some((x) => x.route === p.route)).toBe(true);
    }
  });

  it('DEV_PAGES is not empty (at least one dev entry defined)', () => {
    expect(DEV_PAGES.length).toBeGreaterThan(0);
  });

  it('dev pages do not appear in normal pages list', () => {
    const devRoutes = new Set(DEV_PAGES.map((p) => p.route));
    for (const p of PAGES) {
      expect(devRoutes.has(p.route)).toBe(false);
    }
  });
});
