// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression pin — #816 ("Target detail panel: aliases/notes/coverage/links/
 * back-button silently clipped by DetailPane fill-mode overflow:hidden"):
 * `DetailPane fill` (primitives.css `.pv-detail--fill`) sets `overflow:
 * hidden` on the pane itself and expects exactly one descendant to establish
 * its own `overflow-y: auto` scroll region. `TargetDetailV2` used to dump all
 * of its post-header content as flat siblings with no such region, so
 * everything below the altitude graph — including the back button — sat
 * beyond the pane's clipped bottom edge with NO way for a mouse-wheel user to
 * ever scroll it into view (an `overflow:hidden` box is not wheel-scrollable,
 * unlike `overflow:auto`/`scroll`). Originally fixed by wrapping that content
 * in `.pv-planner__scroll` (`flex:1; min-height:0; overflow-y:auto`,
 * redesign-detail.css).
 *
 * #1107 moved that scroll region out one level. The root cause was that
 * `DetailPanel` only rendered its content wrapper when a facts/aux rail slot
 * was passed, and no page ever passed one — so no scroll region existed and
 * every feature had to grow its own. The wrapper is now unconditional and owns
 * the scrolling for all six detail pages; `.pv-planner__scroll` is a plain
 * layout div. This test therefore asserts on `.pv-detailpanel__content`, and
 * aims the wheel at the visible pane rather than at a scroll region whose
 * centroid can fall outside the viewport.
 *
 * IMPORTANT: this deliberately drives a real mouse-wheel event
 * (`page.mouse.wheel`) rather than `locator.scrollIntoViewIfNeeded()` /
 * `Element.scrollIntoView()`. The latter are scripted and, per the CSSOM View
 * spec, will happily set `scrollTop` on an `overflow:hidden` ancestor too —
 * so they'd report the button "visible" even with the pre-fix CSS, silently
 * defeating this regression pin. A wheel event only moves content inside a
 * true `overflow:auto`/`scroll` region, exactly like a real user's scroll
 * gesture, so it actually distinguishes the fixed layout from the clipped one.
 *
 * Verification layer: PE — Playwright mocks-UI (run in WSL).
 */
import type { Locator } from '@playwright/test';
import {
  disableOnboarding,
  expect,
  seedSetupComplete,
  test,
} from './support/harness';

/** `locator.boundingBox()` types as nullable; every call site here expects the
 * element to be laid out (it's already asserted present), so fail loudly
 * instead of asserting away the null. */
async function requireBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('expected a bounding box, element is not laid out');
  }
  return box;
}

test.describe('Regression · Target detail pane content unclipped (#816)', () => {
  test('mouse-wheel scrolling the detail pane reveals the back button below the altitude graph', async ({
    page,
  }) => {
    // Short enough that the header + pill row + altitude graph alone fill the
    // pane — pre-fix this pushed the back button out under overflow:hidden
    // with no scrollable region to wheel it back into view.
    await page.setViewportSize({ width: 1100, height: 620 });
    seedSetupComplete(page);
    await page.goto('/#/targets');
    await disableOnboarding(page);

    const m31 = page.locator('.pv-targets-table__row', { hasText: 'M 31' });
    await expect(m31).toBeVisible({ timeout: 8_000 });
    await m31.click();

    const pane = page.locator('.pv-detail--fill');
    // The pane's content lives in DetailPanel's shared scroll region (#1107).
    // Before that, each feature supplied its own — here `.pv-planner__scroll`,
    // which is now a plain layout div inside the shared one.
    const scrollRegion = page.locator('.pv-detailpanel__content');
    await expect(scrollRegion).toBeVisible();

    const backBtn = page.getByRole('button', { name: '← All targets' });
    const beforeBox = await requireBox(backBtn);
    const paneBox = await requireBox(pane);
    // Before scrolling, the back button (last element in the region) sits
    // below the pane's own clipped bottom edge — this holds both pre- and
    // post-fix, since it's the natural (unscrolled) layout position.
    expect(beforeBox.y).toBeGreaterThan(paneBox.y + paneBox.height);

    // Real wheel scroll over the PANE, which is what a user actually points at.
    //
    // Deliberately not the scroll region's own centroid: whichever element owns
    // the scrolling is unbounded in height (it is the full content), so at this
    // short 620px viewport its midpoint lands *below the window* and the wheel
    // hits nothing. That is what broke this test under #1107 — not the
    // behaviour, which was re-verified by hand: the button travels from y=1204
    // to y=536, above the pane bottom at 594, visible and enabled. Aiming at
    // the visible pane keeps the assertion about user-facing behaviour rather
    // than about which div happens to carry `overflow-y`.
    await page.mouse.move(
      paneBox.x + paneBox.width / 2,
      paneBox.y + paneBox.height / 2,
    );
    await page.mouse.wheel(0, 3000);

    // Post-fix, the wheel scroll moves the button up into the pane's
    // clipped viewport — it now overlaps the pane's own bounding box.
    await expect(async () => {
      const afterBox = await requireBox(backBtn);
      expect(afterBox.y).toBeLessThan(paneBox.y + paneBox.height);
      expect(afterBox.y + afterBox.height).toBeGreaterThan(paneBox.y);
    }).toPass({ timeout: 2_000 });
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toBeEnabled();
  });
});
