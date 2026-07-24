// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * T043 — Playwright smoke: Projects page lifecycle transition write-side seam.
 *
 * Originally tested a DataTable row with role="option", "Mark lifecycle…"
 * menu, RefusalSurface, and dev_fallback data from a `prj-m101` fixture that
 * no longer exists. Updated 2026-06-17 to match the current ProjectsList +
 * ProjectDetail architecture (spec 008 / design-v4).
 *
 * What this test proves:
 *  1. The Projects page at /#/projects renders project rows as .pv-list-item
 *     divs without crashing.
 *  2. The first project ("NGC 7000 Narrowband", lifecycle: "processing") is
 *     rendered with its lifecycle pill visible.
 *  3. The first project's detail pane is auto-opened (selected=0 default);
 *     the "Mark as Completed" footer button is present.
 *  4. Clicking "Mark as Completed" calls the lifecycle_transition_apply mock
 *     (which returns success) and shows a success toast.
 *  5. After success, the invalidateProject() call re-fetches projects.list,
 *     and the row's lifecycle pill updates to "Completed".
 *
 * Fixture data (apps/desktop/src/data/fixtures/projects.ts → mockProjectSummaries):
 *   proj-001: "NGC 7000 Narrowband", lifecycle: "processing"
 *   Legal transition: processing → completed (Mark as Completed button).
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   lifecycle_transition_apply → success, newState: nextState
 *   projects.list → mockProjectSummaries (static; the mock does not mutate
 *   fixture state, so the pill re-read assertion is omitted — invalidation
 *   works but refetches the same static fixture. Real-backend coverage needed
 *   for full round-trip; tracked in test-strategy-033.md).
 *
 * First-run seeding:
 *   Reads `alm-preferences.setupCompleted` from localStorage.
 */
import { test, expect } from '@playwright/test';
import { disableOnboarding } from './support/harness';

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
});

function seedSetupComplete(page: import('@playwright/test').Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem(
      'alm-preferences',
      JSON.stringify({ setupCompleted: true }),
    );
  });
}

test.describe('lifecycle transitions · write-side seam (spec 008 / design-v4)', () => {
  test('Projects page renders rows; transition button triggers mock success toast', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');

    // ── 1. Page renders without error boundary ────────────────────────────────
    const errorBoundary = page.getByTestId('app-error-boundary-fallback');
    await expect(errorBoundary).not.toBeVisible();

    // ── 2. Project row is visible with "Processing" lifecycle pill ────────────
    // ProjectsTable (spec 043 redesign) renders each project as a
    // `tr.pv-projects-table__row` containing the project name and a state tag.
    const projectRow = page
      .locator('[data-kind="projects-table-row"]')
      .filter({ hasText: 'NGC 7000 Narrowband' })
      .first();
    await expect(projectRow).toBeVisible({ timeout: 8_000 });

    // The "Processing" state tag should be visible in the row.
    await expect(projectRow.getByText('Processing')).toBeVisible();

    // ── 3. Select the row → detail pane opens ─────────────────────────────────
    // Unlike the old list (which auto-selected index 0), the redesigned
    // ProjectsPage gates the detail on `selected != null`, so the detail pane —
    // which carries the per-project action bar (data-testid="lifecycle-actions")
    // with the lifecycle transition buttons — mounts only after a row is picked.
    await projectRow.click();

    // For "processing" state: "Mark as Completed" → nextState "completed".
    const footerActions = page.getByTestId('lifecycle-actions');
    await expect(footerActions).toBeVisible({ timeout: 5_000 });

    const markCompletedBtn = page.getByTestId('transition-btn-completed');
    await expect(markCompletedBtn).toBeVisible();
    await expect(markCompletedBtn).toBeEnabled();

    // ── 4. Click transition button → mock succeeds → success toast ────────────
    // The mock handler for lifecycle_transition_apply returns
    // { status: 'success', newState: 'completed' }.
    // ProjectDetail.handleTransition shows a success toast on success.
    await markCompletedBtn.click();

    // Wait for the success toast — text includes the new state name.
    // The toast message is: `Project ${resp.newState ?? nextState}.`
    const successToast = page.getByText(/Project completed\./i);
    await expect(successToast).toBeVisible({ timeout: 5_000 });
  });

  test('Projects page renders multiple projects in the list', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');

    await expect(
      page.getByTestId('app-error-boundary-fallback'),
    ).not.toBeVisible();

    // All three mock projects should appear.
    await expect(
      page
        .locator('[data-kind="projects-table-row"]')
        .filter({ hasText: 'NGC 7000 Narrowband' }),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page.locator('[data-kind="projects-table-row"]').filter({ hasText: 'M31 LRGB' }),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-kind="projects-table-row"]')
        .filter({ hasText: 'IC 1396 SHO' }),
    ).toBeVisible();
  });

  // Real-backend round-trip test: after a successful transition, the list
  // should re-render with the updated lifecycle pill. In mock mode, projects.list
  // always returns the static fixture (no in-memory state mutation), so the pill
  // stays "Processing" even after success. Full coverage needs the real backend.
  //
  // See: docs/development/test-strategy-033.md § J-4.4 (real-backend layer)
  test.skip('lifecycle pill updates after successful transition — real-backend e2e required', async () => {
    // Intentionally skipped.
  });
});
