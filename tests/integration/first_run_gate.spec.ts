/**
 * T009 — Integration test: first-run gate behavior
 *
 * Tests that the index route redirects to /setup when first-run is
 * incomplete, and to /sessions when complete.
 *
 * Requires: `VITE_USE_MOCKS=true just dev` running on localhost:5173
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('First-run gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
  });

  test('redirects to /setup when setupCompleted is absent', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/#/');
    await page.waitForURL(/setup/);
    await expect(page.locator('text=Welcome')).toBeVisible();
  });

  test('redirects to /sessions when setupCompleted is true', async ({ page }) => {
    await page.evaluate(() => {
      const prefs = { setupCompleted: true };
      localStorage.setItem('alm-preferences', JSON.stringify(prefs));
    });
    await page.goto(BASE + '/#/');
    await page.waitForURL(/sessions/);
    await expect(page.locator('[data-testid="SessionsPage"], text=Sessions')).toBeVisible();
  });

  test('/setup redirects away when setup already completed', async ({ page }) => {
    await page.evaluate(() => {
      const prefs = { setupCompleted: true };
      localStorage.setItem('alm-preferences', JSON.stringify(prefs));
    });
    await page.goto(BASE + '/#/setup');
    await page.waitForURL(/sessions/);
  });
});
