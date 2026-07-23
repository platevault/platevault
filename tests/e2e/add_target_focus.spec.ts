// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression pin — #856 ("search input never gained document.activeElement
 * focus"): the Real-UI E2E leg's `targets_ui_add_target_no_duplicate_on_
 * reconfirm` test failed because a bare `autoFocus` on TargetSearch's input
 * raced Base UI Dialog's own default focus (first tabbable = the header ✕
 * close button). Fixed by PR #870 (Modal `initialFocus` forwarded to
 * `Dialog.Popup`, wired to the search input via a ref) — already unit-tested
 * in `AddTargetDialog.test.tsx`; this pins the same defect at the mock-UI
 * layer so the dialog's real DOM focus behaviour has Playwright coverage too.
 *
 * Verification layer: PE — Playwright mocks-UI (run in WSL).
 */
import {
  test,
  expect,
  seedSetupComplete,
  disableOnboarding,
} from './support/harness';

test.describe('Regression · Add target dialog focus (#856)', () => {
  test('opening Add target focuses the search input, not the close button', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/targets');
    await disableOnboarding(page);

    await page.getByRole('button', { name: 'Add target' }).click();

    const search = page.getByLabel('Search for a target');
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
  });
});
