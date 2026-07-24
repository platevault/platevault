// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spec 055 Phase 2 (T014) — the font-size dial writes an integer root
 * `<html>` font-size at every stop and every rendered element's computed
 * font-size is a whole CSS pixel (never fractional) and never below the
 * documented floor for that stop (SC-003).
 *
 * Per theme.ts's `roundedTextScalePx` (spec 055 T011), the floor is NOT a
 * flat 11px at every stop — it is proportional rounding of the 14px-root
 * scale, and only the `default` (14px root) stop is required to hold the
 * literal 11px floor from FR-003. At `small` (12px root) the floor token
 * (`--pv-text-xs`) rounds to 9px, a documented exception (see plan.md's
 * "Dial rounding" risk note and theme.ts's `roundedTextScalePx` docstring).
 * This test asserts against the per-stop floor theme.ts actually documents,
 * not a universal 11px:
 *   small (12px root):   floor 9px   (xs token)
 *   default (14px root): floor 11px (xs token, FR-003's mandatory floor)
 *   large (16px root):   floor 13px (xs token)
 *
 * Also covers SC-004: the font-size setting must move surfaces that were
 * hardcoded px before spec 055 T012 (e.g. the sidebar group label, formerly
 * a bare `9.5px`) — proof the dial reaches previously-inert surfaces.
 */
import {
  test,
  expect,
  seedSetupComplete,
  disableOnboarding,
} from './support/harness';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
});

const STOPS = [
  { choice: 'small', rootPx: 12, floorPx: 9 },
  { choice: 'default', rootPx: 14, floorPx: 11 },
  { choice: 'large', rootPx: 16, floorPx: 13 },
] as const;

async function selectFontSize(page: Page, choice: string): Promise<void> {
  const select = page.locator('select', {
    has: page.locator(`option[value="${choice}"]`),
  });
  await select.selectOption(choice);
}

test.describe('Spec 055 Phase 2 · font-size dial (T014, SC-003/SC-004)', () => {
  for (const stop of STOPS) {
    test(`${stop.choice} stop: integer root font-size, no fractional computed sizes, floor ${stop.floorPx}px`, async ({
      page,
    }) => {
      seedSetupComplete(page);
      await page.goto('/#/settings/general');
      await selectFontSize(page, stop.choice);

      // Navigate to a data-dense page so the sweep covers real rendered text,
      // not just the settings pane itself.
      await page.goto('/#/sessions');
      await page.waitForLoadState('networkidle');

      const rootFontSize = await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize,
      );
      expect(rootFontSize).toBe(`${stop.rootPx}px`);
      expect(Number.parseFloat(rootFontSize)).toBe(stop.rootPx); // exactly integer, not e.g. "12.0001px"

      const sweep = await page.evaluate(() => {
        const results: { fontSize: string; tag: string }[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
        );
        let node = walker.nextNode();
        while (node) {
          const el = node as Element;
          const fs = getComputedStyle(el).fontSize;
          if (fs) results.push({ fontSize: fs, tag: el.tagName });
          node = walker.nextNode();
        }
        return results;
      });

      const fractional = sweep.filter((r) => {
        const px = Number.parseFloat(r.fontSize);
        return !Number.isInteger(px);
      });
      expect(
        fractional,
        `expected no fractional computed font-size at the ${stop.choice} stop, found: ${JSON.stringify(fractional.slice(0, 10))}`,
      ).toEqual([]);

      const belowFloor = sweep.filter((r) => {
        const px = Number.parseFloat(r.fontSize);
        return px > 0 && px < stop.floorPx;
      });
      expect(
        belowFloor,
        `expected no computed font-size below the ${stop.choice} stop's documented floor (${stop.floorPx}px), found: ${JSON.stringify(belowFloor.slice(0, 10))}`,
      ).toEqual([]);
    });
  }

  test('SC-004: the font-size setting scales a previously-hardcoded surface (sidebar group label)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/sessions');
    await page.waitForLoadState('networkidle');

    const groupLabel = page.locator('[data-testid="sidebar-group-label"]').first();
    await expect(groupLabel).toBeVisible();

    const defaultPx = await groupLabel.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    expect(defaultPx).toBe('11px'); // --pv-text-xs @ default (14px root)

    await page.goto('/#/settings/general');
    await selectFontSize(page, 'large');
    await page.goto('/#/sessions');
    await page.waitForLoadState('networkidle');

    const largePx = await page
      .locator('[data-testid="sidebar-group-label"]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(largePx).toBe('13px'); // --pv-text-xs @ large (16px root)
    expect(largePx).not.toBe(defaultPx);
  });
});
