// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: spec 026 US3/US4 — stale-detection sweep badge +
 * broken-reference detail (T014/T015/T016) and the view audit-history
 * surface (T019).
 *
 * Companion to `source_view_verify.spec.ts` (spec 049 US4 on-demand verify);
 * this file proves the PERSISTED sweep data that's already fresh on every
 * `preparedview.list` load, without requiring a Verify click.
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   preparedview_list → proj-002 also gets `mock-sv-view-stale` (state
 *                        `stale`, one present item + one `missing` item).
 *   plans_list        → when called with the removal/regeneration origin
 *                        filter (as `ViewAuditHistory` always does), returns
 *                        a synthetic removal + regeneration plan scoped to
 *                        `mock-sv-view-stale` via `originPath`.
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

test.describe("source view stale-detection sweep + audit history (spec 026)", () => {
  test("stale badge and broken-reference detail render without a Verify click", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");
    await selectProject(page, "M31 LRGB");

    const row = page.getByTestId("source-view-row-mock-sv-view-stale");
    await expect(row).toBeVisible({ timeout: 8_000 });
    await expect(row).toContainText("Stale");

    // Persisted stale-item summary — visible on load, no interaction needed.
    const summary = page.getByTestId("stale-summary-mock-sv-view-stale");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("1 item(s) need attention");

    // Per-item broken-reference detail rides the sweep's last_observed_state.
    await row.getByText(/inventory ref/).click();
    await expect(page.getByTestId("source-view-item-observed-mock-sv-item-stale-broken")).toContainText(
      "missing",
    );
    await expect(
      page.getByTestId("source-view-item-observed-mock-sv-item-stale-ok"),
    ).toHaveCount(0);

    // Regenerate is offered for a stale view (repair path).
    await expect(page.getByTestId("regenerate-view-mock-sv-view-stale")).toBeVisible();
  });

  test("audit history lists the view's removal and regeneration plans", async ({ page }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");
    await selectProject(page, "M31 LRGB");

    const row = page.getByTestId("source-view-row-mock-sv-view-stale");
    await expect(row).toBeVisible({ timeout: 8_000 });

    await row.getByText("History").click();

    const removalRow = page.getByTestId("view-history-row-mock-sv-plan-removal-1");
    await expect(removalRow).toBeVisible({ timeout: 5_000 });
    await expect(removalRow).toContainText("Removal");
    await expect(removalRow).toContainText("applied");
    await expect(removalRow).toContainText("1 applied, 0 failed");

    const regenRow = page.getByTestId("view-history-row-mock-sv-plan-regen-1");
    await expect(regenRow).toBeVisible();
    await expect(regenRow).toContainText("Regeneration");
    await expect(regenRow).toContainText("partially_applied");
    await expect(regenRow).toContainText("1 applied, 1 failed");

    // History is scoped to this view only — the clean view's plans (none in
    // this fixture) must not leak in.
    await expect(page.getByTestId("view-history-row-mock-sv-plan-removal-1")).toHaveCount(1);
  });
});
