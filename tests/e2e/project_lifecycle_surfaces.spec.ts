// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: Journey 5 (spec 008/011/012/024) — project detail
 * operational surfaces: notes, manifests, outputs (honest empty stub),
 * per-channel integration time, the tool-launch affordance, and the
 * attach/remove-sources gating.
 *
 * Phase B / batch 3 of the E2E revalidation (docs/development/
 * e2e-mock-coverage-audit-2026-07-05.md).
 *
 * What this file proves:
 *  1. Notes surface (spec 024): the persisted note body (`project.note.get`)
 *     renders; the inline editor exposes a textarea with a live byte counter
 *     against the 16 384-byte cap.
 *  2. Manifests surface (spec 024): `project.manifest.list` snapshots render as
 *     rows in the Manifests accordion.
 *  3. Outputs (spec 043 §4): an HONEST empty state — the backend exposes no
 *     accepted-output model yet, so the section shows a teaching empty state
 *     and NEVER fabricated rows (constitution II).
 *  4. Per-channel integration time (spec 008 P7): the channels palette shows
 *     each channel's server-aggregated integration hours.
 *  5. Tool-launch affordance (spec 011): the "Open in {tool}" CTA renders and
 *     is correctly DISABLED with a "configure path" hint when no tool profile
 *     is configured (mock mode has none) — no fabricated launch.
 *  6. Attach-sources (spec 041 FR-051 / spec 008 WP-008-C): the Edit pane's
 *     "Add sources" toggle reveals the SessionSourcePicker (filtered to
 *     sessions not already linked). Removing a source triggers the FR-011
 *     last-confirmed-source guard: an inline confirm step before removal.
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   projects_get           → mockProjectDetailFor(id) — proj-001 processing
 *                            (2 channels: Ha 1.8h, OIII 1.3h), proj-002 ready.
 *   note_get / note_update → persisted note body + update echo.
 *   manifest_list          → 2 snapshot rows (created, lifecycle_transition).
 *   tools_list             → (unhandled) → useToolProfiles degrades to no
 *                            profile → launch CTA disabled + configure hint.
 *   projects_source_remove → returns `lifecycle.last_confirmed_source` unless
 *                            confirmLastSource is set, exercising the guard.
 */
import { test, expect, seedSetupComplete } from './support/harness';

async function selectProject(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const row = page
    .locator('.pv-projects-table__row')
    .filter({ hasText: name })
    .first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect(page.getByTestId('lifecycle-actions')).toBeVisible({
    timeout: 5_000,
  });
}

test.describe('project lifecycle · detail surfaces (Journey 5)', () => {
  test('notes surface: persisted body renders; editor shows a byte counter', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    await selectProject(page, 'NGC 7000 Narrowband');

    // Persisted note body (project.note.get) renders.
    const notesRoot = page.locator('.pv-project-notes__root');
    await expect(page.getByTestId('notes-body')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId('notes-body')).toContainText('SHO palette');

    // Open the inline editor → textarea + live byte counter against the cap.
    await notesRoot.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('notes-textarea')).toBeVisible();
    const counter = page.getByTestId('notes-byte-counter');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('16,384');
    await expect(counter).toContainText('bytes');
  });

  test('manifests, outputs empty stub, channel integration time, and tool-launch affordance', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    await selectProject(page, 'NGC 7000 Narrowband');

    // ── Manifests (project.manifest.list) render as rows ─────────────────────
    await expect(page.getByTestId('manifests-list')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId('manifest-row-man-001')).toBeVisible();
    await expect(page.getByTestId('manifest-row-man-002')).toBeVisible();

    // ── Outputs: HONEST empty state, never fabricated rows ───────────────────
    const outputs = page.getByTestId('project-outputs');
    await expect(outputs).toBeVisible();
    await expect(outputs.getByText('No accepted outputs yet')).toBeVisible();

    // ── Per-channel integration time (Ha 1.8h, OIII 1.3h) ────────────────────
    const channels = page.locator('.pv-project-detail__channels-section');
    await expect(channels).toBeVisible();
    await expect(channels.getByText('1.8h')).toBeVisible();
    await expect(channels.getByText('1.3h')).toBeVisible();

    // ── Tool-launch affordance: rendered but disabled (no profile configured) ─
    const launchBtn = page.getByTestId('tool-launch-btn');
    await expect(launchBtn).toBeVisible();
    await expect(launchBtn).toContainText('Open in PixInsight');
    await expect(launchBtn).toBeDisabled();
    // Not-configured hint with a link to the tools settings pane.
    await expect(page.getByTestId('tool-launch-footer')).toBeVisible();
  });

  test("attach sources: the Edit pane's Add-sources toggle reveals the session picker", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    await selectProject(page, 'NGC 7000 Narrowband');

    // Open the project Edit pane (header Edit — the first "Edit" in the detail).
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const editPane = page.getByLabel('Edit project');
    await expect(editPane).toBeVisible({ timeout: 5_000 });

    // Current linked sources are listed.
    await expect(editPane.getByText('NGC 7000 Ha 2024-11')).toBeVisible();

    // The Add-sources toggle reveals the shared SessionSourcePicker (filtered to
    // sessions not already linked to this project).
    await editPane.getByRole('button', { name: 'Add sources' }).click();
    await expect(editPane.locator('.pv-source-picker')).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByTestId('app-error-boundary-fallback'),
    ).not.toBeVisible();
  });

  test('remove source: the last-confirmed-source guard requires an inline confirm (FR-011)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    // proj-002 (ready) is not source-remove-locked, so the Remove affordance is
    // active — clicking it exercises the guard.
    await selectProject(page, 'M31 LRGB');

    await page.getByRole('button', { name: 'Edit' }).first().click();
    const editPane = page.getByLabel('Edit project');
    await expect(editPane).toBeVisible({ timeout: 5_000 });

    // Click the first Remove → the mock returns lifecycle.last_confirmed_source,
    // which the pane surfaces as an inline confirm guard rather than removing.
    await editPane.getByRole('button', { name: 'Remove' }).first().click();
    await expect(
      editPane.getByText("You can't remove the last confirmed source."),
    ).toBeVisible({ timeout: 5_000 });

    // Confirming re-issues the removal with confirm_last_source=true (mock
    // succeeds); no crash.
    await editPane.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      page.getByTestId('app-error-boundary-fallback'),
    ).not.toBeVisible();
  });
});

test.describe('project detail · source click-through (#720 FR-006/SC-002/SC-001)', () => {
  test('a source row deep-links to its Inventory/Sessions entry', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    await selectProject(page, 'NGC 7000 Narrowband');

    // The source name renders as a real anchor, not inert text.
    const link = page.getByTestId('project-source-link-inv-001');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '#/sessions?selected=inv-001');

    // Clicking navigates to Sessions with the source pre-selected (deep link).
    await link.click();
    await expect(page).toHaveURL(/#\/sessions\?selected=inv-001/);
  });

  test("a blocked project row's warning icon carries the real blocked reason (SC-001)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    const blockedRow = page
      .locator('.pv-projects-table__row')
      .filter({ hasText: 'Cave Nebula attempt' });
    await expect(blockedRow).toBeVisible({ timeout: 8_000 });
    // Mock fixture: proj-007 is blocked with blockedReasonKind=calibration_unmatched.
    await expect(
      blockedRow.getByRole('img', { name: /Blocked: .+/ }),
    ).toBeVisible();
  });
});

test.describe('projects list · multiselect state filter (#721 009 SC-004 / 033 FR-022)', () => {
  test('selecting multiple states filters the table; the URL round-trips as a CSV', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects');
    await expect(
      page
        .locator('.pv-projects-table__row')
        .filter({ hasText: 'NGC 7000 Narrowband' }),
    ).toBeVisible({ timeout: 8_000 });

    // Open the State multiselect popover and check two states.
    await page.locator('#filterbar-state summary').click();
    await page.locator('#filterbar-state-processing').check();
    await page.locator('#filterbar-state-blocked').check();

    // URL reflects both selections (router search serializes the array as
    // URL-encoded JSON: lifecycle=["processing","blocked"]).
    await expect(page).toHaveURL(
      /lifecycle=%5B%22processing%22%2C%22blocked%22%5D/,
    );

    // Table now shows only the processing + blocked projects.
    await expect(
      page
        .locator('.pv-projects-table__row')
        .filter({ hasText: 'NGC 7000 Narrowband' }),
    ).toBeVisible();
    await expect(
      page
        .locator('.pv-projects-table__row')
        .filter({ hasText: 'Cave Nebula attempt' }),
    ).toBeVisible();
    await expect(
      page.locator('.pv-projects-table__row').filter({ hasText: 'M31 LRGB' }),
    ).not.toBeVisible();
  });

  test('a deep-linked CSV lifecycle param pre-checks the matching states and filters the table', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/projects?lifecycle=ready,prepared');

    await expect(
      page.locator('.pv-projects-table__row').filter({ hasText: 'M31 LRGB' }),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page
        .locator('.pv-projects-table__row')
        .filter({ hasText: 'NGC 7000 Narrowband' }),
    ).not.toBeVisible();

    // The popover reflects the deep-linked selection (2 selected).
    await expect(page.locator('#filterbar-state summary')).toContainText(
      '2 selected',
    );
  });
});
