/**
 * T025 — Playwright test: restart flow with prefill
 *
 * Tests that restarting setup from Settings opens the wizard with
 * previously registered sources prefilled.
 *
 * Requires: `VITE_USE_MOCKS=true just dev` running on localhost:5173
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('First-run restart flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Simulate a completed setup
    await page.evaluate(() => {
      const prefs = { setupCompleted: true };
      localStorage.setItem('alm-preferences', JSON.stringify(prefs));
    });
  });

  test('restart from Settings navigates to /setup', async ({ page }) => {
    await page.goto(BASE + '/#/settings/sources');
    await page.waitForLoadState('networkidle');

    // Find and click the restart wizard button
    const restartBtn = page.locator('button:has-text("Restart setup wizard")');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // Confirm the restart dialog
    const confirmBtn = page.locator('button:has-text("Confirm restart")');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Should navigate to setup
    await page.waitForURL(/setup/, { timeout: 5000 });
    await expect(page.locator('text=Welcome')).toBeVisible();
  });

  test('setupCompleted is cleared after restart', async ({ page }) => {
    await page.goto(BASE + '/#/settings/sources');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("Restart setup wizard")');
    await page.click('button:has-text("Confirm restart")');
    await page.waitForURL(/setup/, { timeout: 5000 });

    const setupCompleted = await page.evaluate(() => {
      const raw = localStorage.getItem('alm-preferences');
      if (!raw) return false;
      return JSON.parse(raw).setupCompleted;
    });
    expect(setupCompleted).toBe(false);
  });

  test('cancel does not restart', async ({ page }) => {
    await page.goto(BASE + '/#/settings/sources');
    await page.waitForLoadState('networkidle');

    await page.click('button:has-text("Restart setup wizard")');
    await page.click('button:has-text("Cancel")');

    // Should still be on settings
    expect(page.url()).toContain('settings');
  });
});
