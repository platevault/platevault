// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: removal + restore controls (spec 056, US5 T031).
 *
 * Covers the section-header "Remove getting started" menu + one-line confirm
 * (T029) and the Settings → Advanced restore control (T030).
 *
 * SECTION-level removal is the only per-checklist removal control that exists:
 * the per-row dismiss "X" was deliberately deleted (the round checkbox is the
 * single per-item affordance). This file covers the surviving header ··· menu.
 *
 * The checklist now lives only inside the `.pv-onb-ring` flyout (portalled to
 * `document.body`), so `.pv-onb-checklist` — and with it the header menu — is
 * absent until the ring is clicked; see `openChecklist`.
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
test.describe('onboarding removal + restore controls (spec 056 US5)', () => {
  test('header menu offers Remove with a one-line confirm using the Paraglide copy (T029)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    await page.getByRole('button', { name: 'Getting started options' }).click();
    const remove = page.getByRole('menuitem', {
      name: 'Remove getting started',
    });
    await expect(remove).toBeVisible();

    await remove.click();
    // One-line confirm copy comes straight from `onboarding_section_remove_confirm`.
    await expect(
      page.locator('[data-testid="onb-checklist-menu-confirm-text"]'),
    ).toContainText('Remove the getting-started checklist?');
    await expect(
      page.locator('[data-testid="onb-checklist-menu-confirm-yes"]'),
    ).toBeVisible();

    // Cancel closes the confirm and leaves the section in place.
    await page.locator('[data-testid="onb-checklist-menu-confirm-no"]').click();
    await expect(
      page.locator('[data-testid="onb-checklist-menu-confirm-text"]'),
    ).toHaveCount(0);
    await expect(page.locator(SECTION)).toBeVisible();
  });

  test('Settings → Advanced renders the restore control with its Paraglide label (T030)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/settings/advanced');

    const restore = page.getByTestId('onboarding-restore-btn');
    await expect(restore).toBeVisible({ timeout: 8_000 });
    await expect(restore).toHaveText('Restore getting started');
    // Beside the T015 replay control in the same section.
    await expect(page.getByTestId('onboarding-replay-btn')).toBeVisible();
  });

  test('removing the section hides it (and the ring) permanently across a reload (FR-013)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    await page.getByRole('button', { name: 'Getting started options' }).click();
    await page
      .getByRole('menuitem', { name: 'Remove getting started' })
      .click();
    await page.locator('[data-testid="onb-checklist-menu-confirm-yes"]').click();

    // Removal unmounts the flyout AND its sidebar ring trigger, and the mock
    // persists `sectionHidden`, so a reload must not bring either back.
    await expect(page.locator(SECTION)).toHaveCount(0);
    await expect(page.locator(RING)).toHaveCount(0);
    await page.reload();
    await expect(page.locator(RING)).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator(SECTION)).toHaveCount(0);
  });

  test('restore brings the section back with re-derived pre-ticked state (FR-014)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    // Remove it …
    await page.getByRole('button', { name: 'Getting started options' }).click();
    await page
      .getByRole('menuitem', { name: 'Remove getting started' })
      .click();
    await page.locator('[data-testid="onb-checklist-menu-confirm-yes"]').click();
    await expect(page.locator(SECTION)).toHaveCount(0);

    // … then restore from Settings → Advanced.
    await page.goto('/#/settings/advanced');
    await page.getByTestId('onboarding-restore-btn').click();
    await page.goto('/#/sessions');
    // The ring trigger comes back first; the section is behind it again.
    await openChecklist(page);
  });
});
