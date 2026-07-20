// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: completion choreography (spec 056, US3 T025).
 *
 * Covers the completion choreography layered onto `ChecklistSection.tsx` by
 * T024: an in-place check animation + emphasis, the drop to the group's
 * completed area, the automatic-tick progress pulse, and the polite per-tick
 * aria-live announcement, plus reduced-motion parity.
 *
 * The checklist is only mounted inside the `.pv-onb-ring` flyout (portalled to
 * `document.body`), so every test opens it first — see `openChecklist`.
 *
 * ── Mock-mode coverage limit (VC-002) ───────────────────────────────────────
 *  The AUTOMATIC-tick progress pulse cannot be exercised in mock mode: only the
 *  real bus subscriber emits `source === 'event'` ticks (research R5 / VC-002),
 *  and `useCompletionChoreography` pulses on that source alone. Documented
 *  below; covered by the backend / Layer-2 lane instead.
 *
 * ── No per-row dismiss ──────────────────────────────────────────────────────
 *  The per-row dismiss "X" was deliberately removed: the round checkbox is the
 *  single per-item completion affordance, and whole-section removal lives in
 *  the section header's ··· menu (covered by `onboarding_removal.spec.ts`).
 *  The dismiss choreography test that used to live here was deleted with it —
 *  re-pointing it at the checkbox would have duplicated the manual check-off
 *  test below verbatim.
 */

import {
  test,
  expect,
  landOnMockRoute,
  openChecklist,
  ONB_SECTION as SECTION,
  ONB_RING as RING,
} from './support/harness';
import type { Page } from '@playwright/test';

/** Open the checklist flyout and wait for its body (no-op when already open). */
test.describe('onboarding completion choreography (spec 056 US3)', () => {
  test('renders a polite aria-live region for per-tick announcements (T024)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const announcer = page.locator(
      `${SECTION} [role="status"][aria-live="polite"]`,
    );
    await expect(announcer).toHaveCount(1);
  });

  test('manual check-off plays the in-place choreography then moves the item to the completed area', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const row = page.locator('[data-item-id="sessions.review_first"]');
    await page.getByRole('checkbox', { name: 'Review a session' }).click();

    // In place first: the row carries the completing marker while it animates.
    await expect(row).toHaveAttribute('data-completing', 'true');
    // Then it settles into the greyed, checked completed area of its group.
    await expect(
      page.locator(
        `.pv-onb-checklist__completed [data-item-id="sessions.review_first"]`,
      ),
    ).toBeVisible();
  });

  test('a completed item can be un-checked from the completed area', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const done = page.locator(
      `.pv-onb-checklist__completed [data-item-id="sessions.review_first"]`,
    );

    await page.getByRole('checkbox', { name: 'Review a session' }).click();
    await expect(done).toBeVisible();

    // The completed row is struck through and greyed rather than hidden
    // precisely so it can be taken back — its tick is a live control, not
    // decoration. A click landing on a crossed-out row and doing nothing
    // would read as broken.
    await done.getByRole('checkbox').click();

    await expect(done).toHaveCount(0);
    // Back among the group's open items, checkable again.
    await expect(
      page.getByRole('checkbox', { name: 'Review a session' }),
    ).toBeVisible();
  });

  test.describe('reduced motion parity', () => {
    // `reducedMotion` moved out of the top-level `PlaywrightTestOptions` type
    // in @playwright/test 1.61.1 (still a real BrowserContextOptions field,
    // still applied at runtime) — set it via the `contextOptions` escape
    // hatch instead of the removed direct property.
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('completion applies the final state instantly with no animation (FR-020)', async ({
      page,
    }) => {
      await landOnMockRoute(page, '/#/sessions');
      await openChecklist(page);

      await page.getByRole('checkbox', { name: 'Review a session' }).click();

      // No transient completing marker under reduced motion …
      await expect(page.locator('[data-completing="true"]')).toHaveCount(0);
      // … the item is in its final completed-area state immediately.
      await expect(
        page.locator(
          `.pv-onb-checklist__completed [data-item-id="sessions.review_first"]`,
        ),
      ).toBeVisible();
    });
  });

  // No fixtures are destructured: an empty pattern would trip both eslint's
  // no-empty-pattern and biome's noEmptyPattern, and the eslint-disable comment
  // cannot suppress the biome rule.
  test.skip('automatic tick pulses the progress line / ring (VC-002)', async () => {
    // NOT mock-coverable: an `auto_checked` tick (`source === 'event'`) is only
    // ever produced by the real backend bus subscriber (research R5). The mock
    // cannot fabricate one, so the progress-line / progress-ring pulse on a
    // side-effect tick is covered by the backend / Layer-2 lane, not here.
  });
});
