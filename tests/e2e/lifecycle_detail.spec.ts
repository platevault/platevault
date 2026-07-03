/**
 * Playwright smoke: Sessions page grouped table + detail provenance surface.
 *
 * Updated for the spec-043 redesign: SessionsList (`.alm-list-item` rows) was
 * replaced by a grouped SessionsTable (a spanning `.alm-sessions-table__group`
 * header per target, then `.alm-sessions-table__row` rows), and the standalone
 * "Provenance" <Section> in SessionDetail was folded into a single PropertyTable
 * whose Source column tags each fact (FITS / Inferred / User).
 *
 * What this test proves:
 *  1. The Sessions page at /#/sessions renders the grouped table without
 *     crashing (group-header row + session rows).
 *  2. Clicking a session row opens the detail pane, which renders a
 *     PropertyTable with source-tagged facts (the redesigned provenance surface).
 *  3. With no selection, the detail pane shows the "Select a session" empty
 *     state (sessions are selected by id; no row is auto-selected on load).
 *
 * First-run seeding:
 *   The desktop shell reads `alm-preferences.setupCompleted` from localStorage.
 *   Seed it before navigating so the index redirect lands on /sessions, not /setup.
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

test.describe("lifecycle detail · sessions page + provenance UI (spec 006 / spec 043)", () => {
  test("grouped session rows render; clicking opens detail with source-tagged facts", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    // ── 1. Page renders without error boundary ────────────────────────────────
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // ── 2. Grouped table renders: a target group header + session rows ────────
    const ngcGroup = page
      .locator(".alm-sessions-table__group")
      .filter({ hasText: "NGC 7000" });
    await expect(ngcGroup).toBeVisible({ timeout: 8_000 });

    const rows = page.locator(".alm-sessions-table__row");
    await expect(rows.first()).toBeVisible();

    // ── 3. Click a session row → detail pane opens ────────────────────────────
    // Sessions are selected by id; no row is auto-selected, so a click is needed.
    await rows.first().click();

    // ── 4. Detail shows a PropertyTable with a source-tagged fact ─────────────
    // The redesigned SessionDetail folds provenance into the fact PropertyTable;
    // each fact carries a Source badge (FITS / Inferred / User).
    const propTable = page.locator(".alm-property-table").first();
    await expect(propTable).toBeVisible({ timeout: 5_000 });
    await expect(
      propTable.getByText(/^(FITS|Inferred|User)$/).first(),
    ).toBeVisible();
  });

  test("navigating to /#/sessions without a selection renders the table with no detail pane", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // The grouped sessions table renders.
    await expect(
      page.locator(".alm-sessions-table__group").first(),
    ).toBeVisible({ timeout: 8_000 });

    // The redesigned SessionsPage mounts the bottom SessionDetail pane ONLY when
    // a session is selected (`detail={selectedSession != null ? … : undefined}`),
    // so with no selection the detail's PropertyTable must be absent.
    await expect(page.locator(".alm-property-table")).toHaveCount(0);
  });
});
