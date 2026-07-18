// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: Journey 5 (spec 008/009/017) — the FULL project
 * lifecycle state machine, extending the single processing→completed button
 * already covered by `lifecycle_transitions.spec.ts`.
 *
 * Phase B / batch 3 of the E2E revalidation (docs/development/
 * e2e-mock-coverage-audit-2026-07-05.md).
 *
 * What this file proves:
 *  1. Each lifecycle state surfaces its correct contextual footer transitions
 *     (spec 009 US3 `lifecycleFooterActions`): ready, prepared, processing,
 *     completed, archived, blocked. This is driven by the arg-sensitive
 *     `projects.get` mock (mockProjectDetailFor) so the detail reflects the
 *     selected project's actual lifecycle.
 *  2. A non-plan-gated edge (prepared → processing) applies immediately and
 *     surfaces the success toast (`projects_toast_transitioned`).
 *  3. A plan-gated NON-archive edge (ready → prepared) returns `plan.required`
 *     and surfaces the "a filesystem plan is required" info toast WITHOUT
 *     opening the archive review overlay (that edge has no generator).
 *  4. The full plan.required review overlay path for completed → archived
 *     (transition → plan.required → generate archive plan → review overlay →
 *     protection gate → approve → apply with live progress), reusing the
 *     shared {@link PlanReviewOverlay} kit (constitution II — reviewable,
 *     never-silent mutation; the archive lifecycle flip only happens via the
 *     applied origin=archive plan).
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   projects_list             → mockProjectSummaries (proj-001…proj-007, one
 *                               per lifecycle state).
 *   projects_get              → mockProjectDetailFor(id) — lifecycle per id.
 *   lifecycle_transition_apply→ success on non-plan edges; { error.code:
 *                               'plan.required' } on plan-gated edges
 *                               (MOCK_PLAN_REQUIRED_EDGES).
 *   archive_plan_generate     → { planId: 'plan-archive-mock', itemCount: 4,
 *                               protectedItemCount: 1 }.
 *   plans_get / plan_protection_check_cmd / plans_approve / plans_apply_real →
 *                               the shared review→approve→apply chain (same
 *                               fixtures the cleanup flow exercises).
 *
 * The Tauri `Channel` polyfill the approve-and-apply path needs is installed
 * globally by the shared harness `test` (tests/e2e/support/harness.ts).
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

test.describe("project lifecycle · full state machine (Journey 5)", () => {
  test("each state surfaces its correct contextual footer transitions", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // ready → { Prepare (plan-gated), Mark as Processing }
    await selectProject(page, "M31 LRGB");
    await expect(page.getByTestId("transition-btn-prepared")).toHaveText("Prepare");
    await expect(page.getByTestId("transition-btn-processing")).toHaveText(
      "Mark as Processing",
    );

    // prepared → { Mark as Processing, Revert to Ready (plan-gated) }
    await selectProject(page, "Heart Nebula SHO");
    await expect(page.getByTestId("transition-btn-processing")).toHaveText(
      "Mark as Processing",
    );
    await expect(page.getByTestId("transition-btn-ready")).toHaveText("Revert to Ready");

    // processing → { Mark as Completed }
    await selectProject(page, "NGC 7000 Narrowband");
    await expect(page.getByTestId("transition-btn-completed")).toHaveText(
      "Mark as Completed",
    );

    // completed → { Archive (plan-gated), Re-open }
    await selectProject(page, "Rosette Nebula HOO");
    await expect(page.getByTestId("transition-btn-archived")).toHaveText("Archive");
    await expect(page.getByTestId("transition-btn-processing")).toHaveText("Re-open");

    // archived → { Unarchive (plan-gated), Unarchive and Resume (plan-gated) }
    await selectProject(page, "Veil Nebula (legacy)");
    await expect(page.getByTestId("transition-btn-ready")).toHaveText("Unarchive");
    await expect(page.getByTestId("transition-btn-processing")).toHaveText(
      "Unarchive and Resume",
    );

    // blocked → BlockedBanner + { Archive (blocked escape) }
    await selectProject(page, "Cave Nebula attempt");
    await expect(page.getByTestId("transition-btn-archived")).toHaveText(
      "Archive (blocked escape)",
    );
  });

  test("non-plan edge (prepared → processing) applies immediately with a success toast", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");

    await selectProject(page, "Heart Nebula SHO");
    await page.getByTestId("transition-btn-processing").click();

    // projects_toast_transitioned → "Project processing."
    await expect(page.getByText(/Project processing\./i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });

  test("plan-gated non-archive edge (ready → prepared) surfaces the plan-required info toast, no overlay", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");

    await selectProject(page, "M31 LRGB");
    await page.getByTestId("transition-btn-prepared").click();

    await expect(
      page.getByText(/A filesystem plan is required before this transition/i),
    ).toBeVisible({ timeout: 5_000 });
    // ready → prepared has no archive generator, so no review overlay opens.
    await expect(page.getByTestId("plan-review-overlay")).toHaveCount(0);
  });

  test("completed → archived drives the full plan.required → review overlay → approve & apply path", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects");

    await selectProject(page, "Rosette Nebula HOO");

    // ── Archive (plan-gated) → plan.required info toast + archive plan created ─
    await page.getByTestId("transition-btn-archived").click();

    await expect(
      page.getByText(/A filesystem plan is required before this transition/i),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/Archive plan created with 4 items — review before anything is moved/i),
    ).toBeVisible({ timeout: 5_000 });

    // ── The shared review overlay opens with the archive title ────────────────
    const overlay = page.getByTestId("plan-review-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay.getByText("Review archive plan")).toBeVisible();
    await expect(
      overlay.getByText(/Nothing has been changed on disk/),
    ).toBeVisible();
    // Every proposed item is reviewable before approval (FR-003/SC-001).
    await expect(overlay.getByTestId("plan-review-items")).toBeVisible();

    // ── Spec-016 protection gate blocks approval until acknowledged ──────────
    const approveBtn = overlay.getByTestId("plan-review-approve-apply");
    await expect(approveBtn).toBeDisabled();
    await overlay.getByRole("button", { name: "Acknowledge" }).click();

    // ── Destructive-confirm gate (FR-003, D9, issue #741): the shared plan
    //    fixture carries `delete` items, so approval also stays locked
    //    behind an explicit destructive-confirm checkbox ───────────────────
    // `.click()` (not `.check()`) — the checkbox's `onChange` awaits a mock
    // IPC round-trip before flipping `checked`, and `.check()`'s single
    // post-click snapshot races that async update.
    await overlay.getByTestId("plan-review-confirm-destructive").click();
    await expect(
      overlay.getByTestId("plan-review-confirm-destructive"),
    ).toBeChecked({ timeout: 5_000 });
    await expect(approveBtn).toBeEnabled({ timeout: 5_000 });

    // ── Approve & apply → plans.approve → plans.apply, live progress ─────────
    await approveBtn.click();
    await expect(overlay.getByTestId("plan-review-progress")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Cleanup plan applied.")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });
});
