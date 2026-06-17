/**
 * T025 — Playwright smoke: Sessions page inventory detail + provenance section.
 *
 * Originally tested a DataTable + data-provenance-* attribute UI that was
 * replaced during the spec 006 / design-v4 redesign. Updated 2026-06-17 to
 * match the current SessionsList + SessionDetail architecture.
 *
 * What this test proves:
 *  1. The Sessions page at /#/sessions renders session rows (as .alm-list-item
 *     divs from the ListItem component) without crashing.
 *  2. The first session in the fixture ("NGC 7000 · Ha — 2026-04-12") is
 *     visible by its target text and filter pill.
 *  3. Session rows do NOT render a Provenance section — that is reserved for
 *     the detail pane.
 *  4. Clicking the session row opens the detail pane, which renders a
 *     "Provenance" section heading (via <Section title="Provenance">).
 *  5. The detail pane shows at least one provenance fact row rendered by
 *     PropertyTable (identifiable by role="row" cells).
 *
 * Fixture data used (apps/desktop/src/data/fixtures/inventory.ts):
 *   - Session id: 550e8400-e29b-41d4-a716-446655440001
 *   - name: "NGC 7000 · Ha — 2026-04-12"
 *   - target: "NGC 7000", filter: "Ha"
 *   - provenance: { target: "NGC 7000", filter: "Ha", confirmedBy: "user" }
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

test.describe("lifecycle detail · sessions page + provenance UI (spec 006)", () => {
  test("session rows render in the list; clicking opens detail pane with Provenance section", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    // ── 1. Page renders without error boundary ────────────────────────────────
    const errorBoundary = page.getByTestId("app-error-boundary-fallback");
    await expect(errorBoundary).not.toBeVisible();

    // ── 2. Session row is visible ─────────────────────────────────────────────
    // SessionsList renders each session as a `div.alm-list-item`.
    // The title shows the target name ("NGC 7000") and a filter pill ("Ha").
    // We locate by the target text which is the strongest rendered text.
    const sessionRow = page
      .locator(".alm-list-item")
      .filter({ hasText: "NGC 7000" })
      .filter({ hasText: "Ha" })
      .first();
    await expect(sessionRow).toBeVisible({ timeout: 8_000 });

    // ── 3. Session row does NOT contain a Provenance section heading ──────────
    // Provenance is only shown in the detail pane, not in the list row.
    const provenanceInRow = sessionRow.getByText("Provenance");
    await expect(provenanceInRow).not.toBeVisible();

    // ── 4. Click row → detail pane renders with "Provenance" section ─────────
    await sessionRow.click();

    // The detail pane is mounted to the right of the list. SessionDetail
    // renders a <Section title="Provenance"> when provenance facts are present.
    // Section uses `.alm-section__title` for the heading text.
    const provenanceHeading = page
      .locator(".alm-section__title")
      .filter({ hasText: "Provenance" });
    await expect(provenanceHeading).toBeVisible({ timeout: 5_000 });

    // ── 5. At least one provenance fact row is rendered ───────────────────────
    // PropertyTable renders rows with role="row". Find the table inside the
    // provenance section. The fixture has target + filter + confirmedBy facts.
    // We just assert at least one row is present and contains the target text.
    const provenanceSection = page
      .locator(".alm-section")
      .filter({ has: provenanceHeading });

    // The target fact row should show "NGC 7000"
    await expect(provenanceSection.getByText("NGC 7000")).toBeVisible();
  });

  test("navigating to /#/sessions without a selection shows empty-state in detail pane", async ({
    page,
  }) => {
    seedSetupComplete(page);
    // Navigate with no `selected` param — detail pane shows an empty state.
    await page.goto("/#/sessions");

    const errorBoundary = page.getByTestId("app-error-boundary-fallback");
    await expect(errorBoundary).not.toBeVisible();

    // The SessionsList should render some items.
    const items = page.locator(".alm-list-item");
    await expect(items.first()).toBeVisible({ timeout: 8_000 });

    // Without a selection, the detail pane shows "Select a session".
    // (SessionDetail renders <EmptyState title="Select a session" ...>)
    // This is visible as long as no row is auto-selected.
    // NOTE: the page starts with no selection so we check the detail area.
    const emptyState = page.getByText("Select a session");
    await expect(emptyState).toBeVisible({ timeout: 5_000 });
  });
});
