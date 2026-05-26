/**
 * T016 — Playwright E2E: full wizard happy path
 *
 * Walks through all 8 wizard steps, adds sources to Raw and Project,
 * skips optional steps, and completes setup.
 *
 * Requires: `VITE_USE_MOCKS=true just dev` running on localhost:5173
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('First-run wizard happy path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/#/setup');
  });

  test('completes all 8 steps end-to-end', async ({ page }) => {
    // Step 0: Welcome
    await expect(page.locator('text=Welcome')).toBeVisible();
    await page.click('button:has-text("Get started")');

    // Step 1: Raw Sources (required)
    await expect(page.locator('text=Step 2 of 8')).toBeVisible();
    // In mock mode, add a folder via the Add button
    await page.click('button:has-text("Add folder")');
    // DirPicker in mock mode should allow input
    const rawInput = page.locator('input[type="text"]').first();
    if (await rawInput.isVisible()) {
      await rawInput.fill('/test/raw');
      await rawInput.press('Enter');
    }
    await page.click('button:has-text("Continue")');

    // Step 2: Calibration Sources (optional — advance freely)
    await expect(page.locator('text=Step 3 of 8')).toBeVisible();
    await page.click('button:has-text("Continue")');

    // Step 3: Project Sources (required)
    await expect(page.locator('text=Step 4 of 8')).toBeVisible();
    await page.click('button:has-text("Add folder")');
    const projectInput = page.locator('input[type="text"]').first();
    if (await projectInput.isVisible()) {
      await projectInput.fill('/test/projects');
      await projectInput.press('Enter');
    }
    await page.click('button:has-text("Continue")');

    // Step 4: Inbox Sources (optional)
    await expect(page.locator('text=Step 5 of 8')).toBeVisible();
    await page.click('button:has-text("Continue")');

    // Step 5: Detect Tools (stub, skip freely)
    await expect(page.locator('text=Step 6 of 8')).toBeVisible();
    await page.click('button:has-text("Continue")');

    // Step 6: Download Catalogs (stub, skip freely)
    await expect(page.locator('text=Step 7 of 8')).toBeVisible();
    await page.click('button:has-text("Continue")');

    // Step 7: Confirm (Finish)
    await expect(page.locator('text=Step 8 of 8')).toBeVisible();
    await page.click('button:has-text("Complete setup")');

    // Should navigate to /sessions after completion
    await page.waitForURL(/sessions/, { timeout: 5000 });
  });

  test('Raw step blocks advancement when empty', async ({ page }) => {
    await page.click('button:has-text("Get started")');
    // On Raw step with no sources
    const continueBtn = page.locator('button:has-text("Continue")');
    await expect(continueBtn).toBeDisabled();
  });

  test('Project step blocks advancement when empty', async ({ page }) => {
    // Advance past Welcome and Raw (add a source in mock mode)
    await page.click('button:has-text("Get started")');
    // Add a raw source
    await page.click('button:has-text("Add folder")');
    const rawInput = page.locator('input[type="text"]').first();
    if (await rawInput.isVisible()) {
      await rawInput.fill('/test/raw');
      await rawInput.press('Enter');
    }
    await page.click('button:has-text("Continue")');
    // Skip Calibration
    await page.click('button:has-text("Continue")');
    // Now on Project step — Continue should be disabled with no sources
    const continueBtn = page.locator('button:has-text("Continue")');
    await expect(continueBtn).toBeDisabled();
  });
});
