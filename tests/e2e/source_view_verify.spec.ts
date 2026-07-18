// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: spec 049 US4 — "Verify before processing" on a
 * generated source view.
 *
 * Seeds `preparedview.list` (mocks.ts) with two already-materialized views
 * on proj-002 ("M31 LRGB") rather than also mocking generate/apply — the
 * Verify action is read-only over an existing `PreparedSourceView` and does
 * not depend on the generation pipeline.
 *
 * What this file proves:
 *  1. Clean case: verifying an all-present view reports "safe to process"
 *     and renders no broken items (SC-006).
 *  2. Broken case: verifying a view with a moved/removed source reports the
 *     broken item (path + reason) without any destructive affordance —
 *     Regenerate remains the only repair path (FR-014/FR-015).
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   preparedview_list → proj-002 gets `mock-sv-view-clean` +
 *                        `mock-sv-view-broken`, both state `current`.
 *   sourceview_verify → `mock-sv-view-broken` reports one broken item
 *                        (state `moved`); every other view id reports clean.
 */
import { test, expect, seedSetupComplete, disableOnboarding } from "./support/harness";

async function selectProject(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  const row = page
    .locator(".alm-projects-table__row")
    .filter({ hasText: name })
    .first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect(page.getByTestId("lifecycle-actions")).toBeVisible({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
});

test.describe("source view verify (spec 049 US4)", () => {
  test("clean view: verify reports safe-to-process with zero broken items", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");
    await selectProject(page, "M31 LRGB");

    await expect(page.getByTestId("source-view-row-mock-sv-view-clean")).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("verify-view-mock-sv-view-clean").click();

    const result = page.getByTestId("verify-view-result-mock-sv-view-clean");
    await expect(result).toBeVisible({ timeout: 5_000 });
    await expect(result).toContainText("Clean");
    await expect(result).toContainText("Safe to process");
  });

  test("broken view: verify reports the broken item, no mutation affordance", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");
    await selectProject(page, "M31 LRGB");

    await expect(page.getByTestId("source-view-row-mock-sv-view-broken")).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("verify-view-mock-sv-view-broken").click();

    const result = page.getByTestId("verify-view-result-mock-sv-view-broken");
    await expect(result).toBeVisible({ timeout: 5_000 });
    await expect(result).toContainText("1 broken item");
    await expect(result).toContainText("light_002.fits");
    await expect(result).toContainText("source moved or removed");

    // No auto-repair affordance inside the verify report itself — repair is
    // only reachable via the row's own Regenerate button (FR-015).
    await expect(result.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });
});
