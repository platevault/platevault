// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression R-1 — index route `/` redirects to `/sessions` (no crash).
 *
 * Before the 2026-06-17 fix, the index route rendered `SessionsPage` directly
 * when `setupCompleted` was true. `SessionsPage` calls
 * `useSearch({from:'/shell/sessions'})`, which throws an invariant when the
 * active match is the index route (`/shell/`) rather than `/shell/sessions`.
 * Every returning user landed on "Something went wrong!" instead of the app.
 *
 * Fix: `indexRoute.beforeLoad` now throws `redirect({to:'/sessions'})` for
 * both the setup-incomplete and setup-complete paths, never rendering
 * `SessionsPage` at the index match.
 *
 * This test pins that behaviour so it cannot silently regress.
 *
 * Verification layers:
 *   PE  — Playwright mocks-UI (this file, router-level assertion)
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § R-1
 *   - docs/development/test-strategy-033.md § J-1.1
 *   - apps/desktop/src/app/router.tsx  indexRoute.beforeLoad
 */
import { test, expect } from '@playwright/test';
import { disableOnboarding } from './support/harness';

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
});

// The app uses createHashHistory — routes are in the URL hash (#/sessions).
// Seed preferences via the `alm-preferences` localStorage key so the
// `checkFirstRunComplete()` call in indexRoute.beforeLoad reads the flag.
function seedSetupComplete(page: import('@playwright/test').Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem(
      'alm-preferences',
      JSON.stringify({ setupCompleted: true }),
    );
  });
}

function seedSetupIncomplete(page: import('@playwright/test').Page): void {
  page.addInitScript(() => {
    window.localStorage.removeItem('alm-preferences');
  });
}

test.describe('Regression R-1 · index route redirect', () => {
  /**
   * When `setupCompleted` is true (returning user), navigating to `/#/` must
   * redirect to `/#/sessions`, NOT render SessionsPage at the index match.
   *
   * Before the fix: the index route rendered `<SessionsPage>` which called
   * `useSearch({from:'/shell/sessions'})` and threw an invariant.
   * After the fix: the index route throws `redirect({to:'/sessions'})`.
   *
   * The error boundary text "Something went wrong!" must NOT appear.
   * The final hash must contain `sessions`.
   */
  test('R-1.1 · /#/ redirects to /#/sessions when setup is complete (not crash)', async ({
    page,
  }) => {
    // Seed setup-complete flag before navigation so the router's beforeLoad
    // sees it when the page initialises.
    seedSetupComplete(page);

    // Navigate to the index hash route.
    await page.goto('/#/');

    // The router redirects via TanStack Router's hash history. The hash in
    // the URL changes from `#/` to `#/sessions`. Wait for the hash to settle.
    await page.waitForFunction(
      () => window.location.hash.includes('sessions'),
      { timeout: 10_000 },
    );

    // Belt-and-braces: the error boundary fallback must NOT be visible.
    const errorBoundary = page.getByTestId('app-error-boundary-fallback');
    await expect(errorBoundary).not.toBeVisible();

    // The TanStack invariant error text must NOT appear.
    const invariantError = page.getByText('Invariant failed');
    await expect(invariantError).not.toBeVisible();
  });

  /**
   * When `setupCompleted` is false (new user), navigating to `/#/` must
   * redirect to `/#/setup`, NOT crash.
   */
  test('R-1.2 · /#/ redirects to /#/setup when setup is incomplete', async ({
    page,
  }) => {
    seedSetupIncomplete(page);

    await page.goto('/#/');

    // Should redirect to the setup wizard hash route.
    await page.waitForFunction(() => window.location.hash.includes('setup'), {
      timeout: 10_000,
    });

    const errorBoundary = page.getByTestId('app-error-boundary-fallback');
    await expect(errorBoundary).not.toBeVisible();
  });

  /**
   * Navigating directly to /#/sessions (not via the index route) must work
   * correctly when setup is complete — this was always working, but we
   * include it as a baseline to distinguish the index-route crash from a
   * deeper render issue on /sessions itself.
   */
  test('R-1.3 · /#/sessions renders without invariant error when navigated directly', async ({
    page,
  }) => {
    seedSetupComplete(page);

    await page.goto('/#/sessions');

    // No error boundary.
    const errorBoundary = page.getByTestId('app-error-boundary-fallback');
    await expect(errorBoundary).not.toBeVisible();

    // No invariant error text.
    const invariantError = page.getByText('Invariant failed');
    await expect(invariantError).not.toBeVisible();
  });
});
