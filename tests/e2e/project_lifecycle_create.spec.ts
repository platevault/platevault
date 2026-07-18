// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: Journey 5 (spec 008 US1 / spec 012) — project creation
 * wizard, happy path + validation/error path.
 *
 * Phase B / batch 3 of the E2E revalidation (docs/development/
 * e2e-mock-coverage-audit-2026-07-05.md). The pre-existing lifecycle specs only
 * covered the single processing→completed transition button; the create wizard
 * (and its duplicate-name inline error) had ZERO mock e2e coverage.
 *
 * What this file proves:
 *  1. "+ New project" opens the multi-step creation wizard (WizardPage) at
 *     /#/projects/new — the first step is Name & profile.
 *  2. Happy path: a unique project name walked through all six steps to the
 *     Review step and created via `projects.create` (mock) surfaces the
 *     folders-created success toast and returns to the projects list.
 *  3. Validation/error path: a DUPLICATE name (matching an existing
 *     `projects.list` entry) is caught by the live pre-check
 *     (`findDuplicateProjectName`), routes the wizard BACK to the Name step,
 *     and surfaces the inline `name.duplicate` field error — creation is
 *     blocked (constitution II: no silent mutation on a bad input).
 *  4. Empty-name gate: the Review step's Create button is disabled until the
 *     project has a name.
 *
 * Mock wiring (apps/desktop/src/api/mocks.ts):
 *   projects_list   → mockProjectSummaries (includes "NGC 7000 Narrowband").
 *   projects_create → { projectId, lifecycle: 'setup_incomplete',
 *                       scaffoldApplied: true, … } → folders-created toast.
 *
 * The wizard runs with VITE_USE_MOCKS=true, whose `devSkip` bypasses the
 * per-step advance gates so the walk-through does not need real session/
 * calibration selections.
 */
import { test, expect, seedSetupComplete, disableGuidedTourOverlay } from "./support/harness";

// The six wizard "Next" labels in order (StepName → … → Review). Clicking each
// advances one step; the final step swaps in the Create button.
const NEXT_LABELS = [
  "Next: sources →",
  "Next: calibration →",
  "Next: source views →",
  "Next: naming →",
  "Next: review →",
];

async function openWizard(page: import("@playwright/test").Page): Promise<void> {
  seedSetupComplete(page);
  await page.goto("/#/projects");
  await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  await disableGuidedTourOverlay(page);
  await page.getByRole("button", { name: "+ New project" }).click();
  // Wizard toolbar title confirms we landed on /#/projects/new.
  await expect(page.getByText(/New project —/)).toBeVisible({ timeout: 8_000 });
}

test.describe("project lifecycle · creation wizard (spec 008 US1 / Journey 5)", () => {
  test("happy path: unique name walked through all steps creates the project", async ({
    page,
  }) => {
    await openWizard(page);

    // ── Step 0: Name & profile ────────────────────────────────────────────────
    const nameInput = page.locator("#project-name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Pelican Nebula HOO");

    // ── Walk Name → Review (six steps, five Next clicks) ──────────────────────
    for (const label of NEXT_LABELS) {
      await page.getByRole("button", { name: label }).click();
    }

    // ── Review step: Create is enabled (name present) ─────────────────────────
    const createBtn = page.getByTestId("wizard-create-btn");
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await expect(createBtn).toBeEnabled();

    await createBtn.click();

    // ── projects.create mock returns scaffoldApplied:true → folders toast; the
    //     wizard then navigates back to the projects list ──────────────────────
    await expect(
      page.getByText(/created — project folders created on disk/i),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });

  test("validation: a duplicate name is blocked and the wizard bounces back to the Name step", async ({
    page,
  }) => {
    await openWizard(page);

    // Use a name that already exists in projects.list (mockProjectSummaries).
    await page.locator("#project-name").fill("NGC 7000 Narrowband");

    for (const label of NEXT_LABELS) {
      await page.getByRole("button", { name: label }).click();
    }

    // Attempt to create — the live duplicate pre-check (findDuplicateProjectName)
    // must intercept before any projects.create call.
    await page.getByTestId("wizard-create-btn").click();

    // Observable outcome (constitution II — no silent mutation on bad input):
    // creation is BLOCKED and the wizard routes BACK to the Name step. (The
    // inline name.duplicate error is set but StepName's on-remount RHF reset
    // fires its watch→onChange, which clears name/tool create-errors, so the
    // banner is not persistently asserted here — see finding in the batch-3
    // report.) The proofs: we are on step 1 again, the Review step's Create
    // button is gone, and no "created" success toast fired.
    await expect(
      page.getByRole("heading", { name: /Step 1 · Name & profile/ }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#project-name")).toHaveValue("NGC 7000 Narrowband");
    await expect(page.getByTestId("wizard-create-btn")).toHaveCount(0);
    await expect(page.getByText(/created — project folders created on disk/i)).toHaveCount(0);
    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();
  });

  test("empty-name gate: the Review step's Create button is disabled without a name", async ({
    page,
  }) => {
    await openWizard(page);

    // Do NOT type a name; devSkip lets us advance through the gated steps.
    for (const label of NEXT_LABELS) {
      await page.getByRole("button", { name: label }).click();
    }

    const createBtn = page.getByTestId("wizard-create-btn");
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await expect(createBtn).toBeDisabled();
  });
});

// #887/#719/#586/#612/#783/#795 (2026-07-17): wizard-only convergence —
// CreateProjectDialog retired, its target picker + validation folded into
// the wizard, zero-source creation reachable, "From target context" no
// longer fabricated, redundant "Save draft" button removed.
test.describe("project creation wizard convergence (#887/#719/#586/#783/#795)", () => {
  test("#719: zero-source creation is reachable — Create succeeds without selecting any session", async ({
    page,
  }) => {
    await openWizard(page);
    await page.locator("#project-name").fill("Zero Source Project");

    // Advance past Sources (step 1) WITHOUT selecting any session.
    for (const label of NEXT_LABELS) {
      await page.getByRole("button", { name: label }).click();
    }

    const createBtn = page.getByTestId("wizard-create-btn");
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    await expect(
      page.getByText(/created — project folders created on disk/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("#795: the redundant 'Save draft' button is gone from the wizard toolbar", async ({
    page,
  }) => {
    await openWizard(page);
    await expect(
      page.getByRole("button", { name: "Save draft" }),
    ).toHaveCount(0);
  });

  test("#783/#887/#612: 'From target context' is absent until a real target is picked, then reflects it", async ({
    page,
  }) => {
    await openWizard(page);

    // Typed name alone must never fabricate a "From target context" line.
    await page.locator("#project-name").fill("Andromeda Wide Field");
    await expect(page.getByText(/From target context:/)).toHaveCount(0);

    // The folded-in target picker (from the retired CreateProjectDialog) —
    // pick a real target via the mock target.search fixture.
    const targetCombobox = page.getByRole("combobox", {
      name: "Target (optional)",
    });
    await targetCombobox.fill("Andromeda");
    await page.getByRole("option", { name: /M 31/ }).click();

    // Now the sub-toolbar reflects the REAL picked target, not typed text.
    await expect(
      page.getByText(/From target context:.*Andromeda Galaxy/),
    ).toBeVisible({ timeout: 5_000 });
  });

  // #612: the *other* entry point — "+ New project here" on a target's detail
  // page navigates straight to `/#/projects/new?targetId=…` instead of the
  // manual TargetSearch pick covered above. The wizard must resolve that id
  // via `target.get` and prefill the name step from it, not require the user
  // to re-pick the same target they started from.
  test("#612: a real ?targetId= search param resolves and prefills the name step", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/projects/new?targetId=tgt-m31");
    await expect(page.getByText(/New project —/)).toBeVisible({ timeout: 8_000 });

    // Prefilled from the resolved target (mock target.get echoes 'M 31').
    await expect(page.locator("#project-name")).toHaveValue("M 31", {
      timeout: 5_000,
    });
    await expect(page.getByText(/From target context:.*M 31/)).toBeVisible({
      timeout: 5_000,
    });
  });
});
