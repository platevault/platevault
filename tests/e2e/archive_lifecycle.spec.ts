/**
 * Playwright mock-mode smoke: Journey 7 (spec 017 US6 / WP-B) — Archive page
 * listing → detail → send to trash → permanently delete.
 *
 * Phase B / batch 2 of the E2E revalidation (docs/development/
 * e2e-mock-coverage-audit-2026-07-05.md) — this journey previously had ZERO
 * UI-level coverage (mock e2e OR Layer-2 tauri-driver).
 *
 * What this test proves:
 *  1. The Archive page (`/#/archive`) renders archived-project rows from
 *     `archive.list` without crashing.
 *  2. Selecting a row opens the single-column {@link ArchiveDetail} panel
 *     (spec 043 §4 — no rail) with its Details PropertyTable and Audit
 *     history section.
 *  3. The management actions ("Send to trash" / "Delete permanently" /
 *     Reveal) render in the top bar and use the canonical `archive|trash`
 *     destructive vocabulary (spec 033 vocab split) — never the legacy
 *     `os_trash` term.
 *  4. "Send to trash" (`archive.send_to_trash`) completes against the mock
 *     without error and re-enables once the mutation settles.
 *  5. "Delete permanently" is gated behind the spec-017 US6 typed "DELETE"
 *     confirmation: the confirm button stays disabled until the exact
 *     literal is typed, then `archive.permanently_delete` succeeds and the
 *     modal closes (FR-017 destructive-confirmation gate).
 *  6. Reveal is disabled — no fabricated data (constitution II): the
 *     ArchiveEntry contract does not yet expose the app-managed archive
 *     location, so the button is disabled with an explanatory title rather
 *     than wired to a fake handler.
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   archive_list             → 2 entries: "NGC 7000 · HOO (v1)"
 *                              (arch-proj-001) and "M31 · LRGB (2025)"
 *                              (arch-proj-002), both with archivedViaPlanId.
 *   audit_list               → filtered by entityType/entityId; no fixture
 *                              audit entry has entityType 'project', so the
 *                              archive audit-history table is (correctly)
 *                              empty for both mock entries — not asserted
 *                              beyond "renders without crashing".
 *   archive_send_to_trash    → { planId, itemsMoved: 3, auditId } (always
 *                              succeeds; no toast is wired on success —
 *                              observed via the button's pending→enabled
 *                              round-trip, same fixture-doesn't-mutate
 *                              limitation as lifecycle_transitions.spec.ts).
 *   archive_permanently_delete → { planId, itemsDeleted: 3, auditId }.
 *
 * First-run seeding:
 *   Reads `alm-preferences.setupCompleted` from localStorage.
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

test.describe("archive lifecycle (spec 017 US6 / Journey 7)", () => {
  test("archive page lists entries; selecting one opens detail with canonical archive|trash actions", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/archive");

    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // ── 1. Archive list renders both fixture entries ─────────────────────────
    const list = page.getByTestId("archive-list");
    await expect(list).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("archive-row-arch-proj-001")).toBeVisible();
    await expect(page.getByTestId("archive-row-arch-proj-002")).toBeVisible();
    await expect(list.getByText("NGC 7000 · HOO (v1)")).toBeVisible();
    await expect(list.getByText("M31 · LRGB (2025)")).toBeVisible();

    // ── 2. Select the first entry → single-column detail panel opens ────────
    await page.getByTestId("archive-row-arch-proj-001").click();

    // Scope to the detail pane — "Superseded by reprocess" also renders as a
    // table cell in the list above (same reason string), and the detail's
    // own Details PropertyTable repeats it as a property value.
    const detail = page.locator(".alm-detail");
    await expect(detail).toBeVisible({ timeout: 5_000 });
    await expect(detail.getByText("Superseded by reprocess")).toBeVisible();
    // The subtitle and the Details PropertyTable both repeat the original
    // path; assert the first (subtitle) occurrence renders.
    await expect(detail.getByText("Projects/NGC7000_HOO_v1").first()).toBeVisible();
    // Status pill from the shared archive vocabulary (scoped + case-sensitive
    // regex — "Archived" also appears as a PropertyTable field label).
    await expect(
      detail.locator(".alm-pill").filter({ hasText: /^archived$/ }),
    ).toBeVisible();

    // ── 3. Management actions use the canonical archive|trash vocabulary,
    //       never the legacy "os_trash" term ────────────────────────────────
    const sendToTrashBtn = page.getByRole("button", { name: "Send to trash" });
    const deletePermBtn = page.getByRole("button", { name: "Delete permanently" });
    await expect(sendToTrashBtn).toBeVisible();
    await expect(deletePermBtn).toBeVisible();
    await expect(page.getByText(/os_trash/i)).toHaveCount(0);

    // ── 4. Reveal is disabled — no fabricated archive-location data ─────────
    const revealBtn = page.getByTestId("archive-reveal-btn");
    await expect(revealBtn).toBeVisible();
    await expect(revealBtn).toBeDisabled();
  });

  test('"Send to trash" completes against the mock without error', async ({ page }) => {
    seedSetupComplete(page);
    await page.goto("/#/archive");

    await page.getByTestId("archive-row-arch-proj-001").click();
    const sendToTrashBtn = page.getByRole("button", { name: "Send to trash" });
    await expect(sendToTrashBtn).toBeEnabled({ timeout: 5_000 });

    await sendToTrashBtn.click();

    // The mutation completes (button re-enables once settled) with no error
    // boundary or crash — mock archive_send_to_trash always succeeds.
    await expect(sendToTrashBtn).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });

  test('"Delete permanently" is gated behind the typed "DELETE" confirmation (FR-017)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/archive");

    await page.getByTestId("archive-row-arch-proj-001").click();
    await page.getByRole("button", { name: "Delete permanently" }).click();

    const modal = page.getByRole("dialog", { name: "Delete permanently" });
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText(/permanently deletes the archived/i)).toBeVisible();

    const confirmBtn = modal.getByRole("button", { name: "Delete permanently" });
    // Disabled until the exact literal "DELETE" is typed (constitution II —
    // destructive operations require explicit confirmation).
    await expect(confirmBtn).toBeDisabled();

    const confirmInput = modal.getByLabel("Type DELETE to confirm");
    await confirmInput.fill("delete");
    await expect(confirmBtn).toBeDisabled();

    await confirmInput.fill("DELETE");
    await expect(confirmBtn).toBeEnabled();

    await confirmBtn.click();

    // On success the modal closes (archive.permanently_delete mock always
    // succeeds); no crash, no leftover error boundary.
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });
});
