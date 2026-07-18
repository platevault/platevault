// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spec 056 US1 — first-run orientation walk (T016).
 *
 * Mock-mode Playwright coverage for the six-stop modal walk: auto-run,
 * Next/Back traversal, Skip and Escape dismissal, replay from Settings, and the
 * VC-002 invariant that the walk carries NO modal-dialog ARIA (no
 * `role="alertdialog"`, no `[aria-modal]`) — the adapter's deliberate
 * non-`tooltipProps`-spread design (research R2).
 *
 * These specs WANT the walk, so they seed setup-complete but do NOT call
 * `disableOnboarding`. The final stop's target lives on the Getting started
 * section built by the checklist node (T018); this branch doesn't carry it, so
 * each test injects a fixed stub with the contracted
 * `data-guide-anchor="onboarding.getting-started"` attribute (a body sibling
 * React never reconciles away) so stop 6 spotlights faithfully.
 *
 * MOCK LIMIT (VC-002): `mockOnboardingFlags` in mocks.ts is module-level, so a
 * full `page.reload()` resets `orientationDone`. The "never auto-run twice"
 * guard is therefore verified within-session here; the across-reload assertion
 * is authored but skipped pending the mock onboarding-flag localStorage
 * round-trip (owned by consolidation).
 */

import { test, expect, seedSetupComplete } from "./support/harness";
import type { Page } from "@playwright/test";

const TOOLTIP = ".alm-onboarding-tooltip";
const PRIMARY = ".alm-onboarding-tooltip__primary";
const BACK = ".alm-onboarding-tooltip__back";
const SKIP = ".alm-onboarding-tooltip__skip";

const STOP_TITLES = [
  "Start in the Inbox",
  "See your sessions",
  "Reuse calibration",
  "Resolve your targets",
  "Build a project",
  "Your getting-started checklist",
];

/**
 * Stub the T018 Getting started section anchor so the final stop resolves on a
 * branch that doesn't yet carry the checklist section. Appended to <body> as a
 * React-agnostic sibling before the app boots.
 */
async function injectSectionAnchor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const add = () => {
      const sel = '[data-guide-anchor="onboarding.getting-started"]';
      if (document.querySelector(sel)) return;
      const el = document.createElement("div");
      el.setAttribute("data-guide-anchor", "onboarding.getting-started");
      el.style.cssText =
        "position:fixed;left:8px;bottom:80px;width:180px;height:40px;";
      document.body.appendChild(el);
    };
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
}

async function expectStop(page: Page, index: number): Promise<void> {
  await expect(page.locator(TOOLTIP)).toBeVisible();
  await expect(
    page.locator(`${TOOLTIP} .alm-onboarding-tooltip__title`),
  ).toHaveText(STOP_TITLES[index]);
}

/** VC-002: the walk never introduces modal-dialog ARIA. */
async function expectNoModalAria(page: Page): Promise<void> {
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  await expect(page.locator("[aria-modal]")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  seedSetupComplete(page);
  await injectSectionAnchor(page);
});

test("auto-runs on first launch and shows the first stop", async ({ page }) => {
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await expectNoModalAria(page);
});

test("traverses all six stops with Next/Back and finishes", async ({
  page,
}) => {
  await page.goto("/#/inbox");

  for (let i = 0; i < STOP_TITLES.length; i++) {
    await expectStop(page, i);
    await expectNoModalAria(page);
    if (i < STOP_TITLES.length - 1) await page.locator(PRIMARY).click();
  }

  // Step back from the final stop, then forward again — Back is on every stop.
  await page.locator(BACK).click();
  await expectStop(page, 4);
  await page.locator(PRIMARY).click();
  await expectStop(page, 5);

  // Finish from the last stop closes the walk.
  await page.locator(PRIMARY).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test("Skip closes the walk immediately", async ({ page }) => {
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test("Escape closes the walk immediately", async ({ page }) => {
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test("does not auto-run a second time within the session", async ({ page }) => {
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  // Client-side navigation away and back must not re-trigger the walk: the
  // backend `orientationDone` flag (flipped by the Skip) gates auto-run.
  await page.goto("/#/sessions");
  await page.goto("/#/inbox");
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test("replays from Settings → Advanced, ignoring the done flag", async ({
  page,
}) => {
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  await page.goto("/#/settings/advanced");
  await page.getByTestId("onboarding-replay-btn").click();

  // Replay restarts from the first stop even though orientation is done.
  await expectStop(page, 0);
  await expectNoModalAria(page);
});

test.skip("does not auto-run after a restart (reload)", async ({ page }) => {
  // TODO(consolidation): un-skip once mock onboarding-flag persistence lands.
  // `mockOnboardingFlags` is module-level and resets on reload, so this asserts
  // the wrong mechanism until the mocks.ts localStorage round-trip exists.
  await page.goto("/#/inbox");
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  await page.reload();
  await page.goto("/#/inbox");
  await expect(page.locator(TOOLTIP)).toBeHidden();
});
