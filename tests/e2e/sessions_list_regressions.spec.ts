// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright regression coverage for the Sessions list/detail defects fixed
 * in the g-sessions lane:
 *
 *  #798 — the "Integration" column shows TOTAL integration time
 *         (frames × per-frame exposure), not the raw per-frame exposure
 *         string that the detail panel already labels "Exposure".
 *  #652 — the Type filter defaults to Light (acquisition), hiding the
 *         calibration session from the default view; switching it to "All"
 *         reveals it.
 *  #865 — clicking a session's linked-project chip lands on Projects WITH
 *         that project selected (not an unselected Projects list).
 *
 * Uses the static mock fixture (`VITE_USE_MOCKS=true`, see playwright.config.ts)
 * — no real backend.
 */
import { test, expect } from "@playwright/test";

function seedSetupComplete(page: import("@playwright/test").Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem(
      "alm-preferences",
      JSON.stringify({ setupCompleted: true }),
    );
  });
}

test.describe("Sessions list — Integration column shows total time (#798)", () => {
  test("a session's Integration cell shows total time, not the raw per-frame exposure", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    // Fixture: M31 · L — 2026-03-28, 120 frames × 195s = 23400s = 6h 30m.
    // (There are several M31 sessions in the fixture — match the specific
    // filter cell so this doesn't accidentally hit a different M31 row.)
    const row = page.locator(".alm-sessions-table__row", {
      has: page.getByText("2026-03-28"),
    }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });
    await expect(row).toContainText("6h 30m");
    await expect(row).not.toContainText("195s");
  });
});

test.describe("Sessions list — Type filter defaults to acquisition (#652)", () => {
  test("the default view hides the calibration session; switching to All reveals it", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    await expect(
      page.locator(".alm-sessions-table__row").first(),
    ).toBeVisible({ timeout: 8_000 });

    // Fixture calibration row: "dark calibration — 2026-04-01" — hidden by default.
    await expect(
      page.getByText(/dark calibration/i),
    ).toHaveCount(0);

    const typeSelect = page.getByRole("combobox", { name: "Type" });
    await expect(typeSelect).toHaveValue("light");
    await typeSelect.selectOption("");

    await expect(page.getByText(/dark calibration/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Sessions detail — project-chip navigation carries the id (#865)", () => {
  test("clicking a linked-project chip lands on Projects with that project selected", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    const row = page.locator(".alm-sessions-table__row", {
      hasText: "NGC 7000",
    }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.click();

    const chip = page.getByRole("button", { name: "NGC 7000 · HOO" });
    await expect(chip).toBeVisible({ timeout: 5_000 });

    // Navigating with the id in the URL is the observable symptom of #865
    // (the caller previously dropped it, `navigate({ to: '/projects' })` with
    // no `search`). The Sessions and Projects mock fixtures are independent
    // files with no shared id space, so ProjectsPage's stale-selection
    // cleanup clears an unrecognized `selected` a moment after mount — assert
    // the URL right after the click, before that cleanup runs, rather than
    // waiting for a final settled state.
    await Promise.all([
      page.waitForURL(/\/projects\?.*selected=/),
      chip.click(),
    ]);
  });
});
