// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Journey 17 — Software update check (mock-mode validation, spec 051).
 *
 * Uses window.__PV_TEST__.updateState to seed specific update phases without
 * the backend updater. `startUpdateSubscription()` reads the hook before the
 * IS_MOCK guard, so it fires for every phase even in a VITE_USE_MOCKS env.
 *
 * Validates the Settings → Advanced Software Update section and the shell
 * update notice against the externally-observable phases: up-to-date,
 * available, and check-failed. The download/install phases run in the
 * backend services crate and are covered by its `update` tests.
 */
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  disableOnboarding,
  seedSetupComplete,
} from './support/harness';

/** Seed window.__PV_TEST__.updateState before the app boots. */
function seedUpdateState(page: Page, state: Record<string, unknown>): void {
  page.addInitScript((s) => {
    (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__ = {
      updateState: s,
    };
  }, state);
}

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
  seedSetupComplete(page);
});

test.describe('Journey 17 · Software update check (mock-mode, spec 051)', () => {
  test('shows "up to date" when update state is up-to-date', async ({
    page,
  }) => {
    seedUpdateState(page, { phase: 'up-to-date' });

    await page.goto('/#/settings/advanced');

    // Software Update section header renders.
    await expect(
      page.getByText('Software Update', { exact: true }).first(),
    ).toBeVisible();

    // Status reads the up-to-date message.
    await expect(page.getByTestId('update-status')).toHaveText(
      "You're running the latest version.",
    );

    // No retry action in the up-to-date state; only the manual "Check for
    // updates" button (astro-plan-bzzbp) is offered.
    await expect(page.getByTestId('update-retry-btn')).toHaveCount(0);
  });

  test('offers Install now and Install on quit when an update is available', async ({
    page,
  }) => {
    seedUpdateState(page, {
      phase: 'available',
      version: '99.0.0',
      body: 'Test release notes',
    });

    await page.goto('/#/settings/advanced');

    // Status reads the available message with the spoofed version.
    await expect(page.getByTestId('update-status')).toHaveText(
      'Update 99.0.0 is available.',
    );

    // Both install choices are offered in Settings and in the shell notice.
    await expect(page.getByTestId('update-install-now-btn')).toBeEnabled();
    await expect(page.getByTestId('update-install-on-quit-btn')).toBeEnabled();
    await expect(page.getByTestId('update-banner-status')).toHaveText(
      'Update 99.0.0 is available.',
    );
    await expect(
      page.getByTestId('update-banner-install-now-btn'),
    ).toBeVisible();
    await expect(
      page.getByTestId('update-banner-install-on-quit-btn'),
    ).toBeVisible();
  });

  test('shows "check failed" message when update state is check-failed', async ({
    page,
  }) => {
    seedUpdateState(page, {
      phase: 'check-failed',
      error: { code: 'network' },
    });

    await page.goto('/#/settings/advanced');

    // Status reads the check-failed message with the catalogue's wording
    // for the failure code.
    await expect(page.getByTestId('update-status')).toHaveText(
      "Couldn't check for updates: the connection to the update server failed.",
    );

    // "Check again" retry button is visible.
    await expect(page.getByTestId('update-retry-btn')).toBeVisible();
    await expect(page.getByTestId('update-retry-btn')).toBeEnabled();

    // No install choice while nothing is available.
    await expect(page.getByTestId('update-install-now-btn')).toHaveCount(0);
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
  });
});
