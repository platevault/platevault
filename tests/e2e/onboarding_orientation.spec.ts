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

import { test, expect, seedSetupComplete } from './support/harness';
import type { Page } from '@playwright/test';

const TOOLTIP = '[data-testid="onboarding-tooltip"]';
const PRIMARY = '[data-testid="onboarding-tooltip-primary"]';
const BACK = '[data-testid="onboarding-tooltip-back"]';
const SKIP = '[data-testid="onboarding-tooltip-skip"]';

const STOP_TITLES = [
  'Start in the Inbox',
  'See your sessions',
  'Reuse calibration',
  'Resolve your targets',
  'Build a project',
  'Your getting-started checklist',
];

// The real route each stop must navigate to (FR-002); the final section stop
// stays on /projects. Hash routing, so match the URL fragment.
const STOP_URLS = [
  /#\/inbox$/,
  /#\/sessions$/,
  /#\/calibration$/,
  /#\/targets$/,
  /#\/projects$/,
  /#\/projects$/,
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
      const el = document.createElement('div');
      el.setAttribute('data-guide-anchor', 'onboarding.getting-started');
      el.style.cssText =
        'position:fixed;left:8px;bottom:80px;width:180px;height:40px;';
      document.body.appendChild(el);
    };
    if (document.body) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
}

async function expectStop(page: Page, index: number): Promise<void> {
  await expect(page.locator(TOOLTIP)).toBeVisible();
  await expect(
    page.locator(`${TOOLTIP} .pv-onboarding-tooltip__title`),
  ).toHaveText(STOP_TITLES[index]);
}

/** VC-002: the walk never introduces modal-dialog ARIA. */
async function expectNoModalAria(page: Page): Promise<void> {
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  await expect(page.locator('[aria-modal]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  // `{ suppressWalk: false }`: this suite exists to test the US1 walk, so it
  // keeps the walk enabled (the mock's own persisted `orientationDone` governs
  // auto-run) rather than the default walk-suppressing seed.
  seedSetupComplete(page, { suppressWalk: false });
  await injectSectionAnchor(page);
});

test('auto-runs on first launch and spotlights the first stop', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  // FR-002 whole-page spotlight: the full-page dim overlay renders (the
  // `center`-placement guard — an anchored placement fails to render on the
  // viewport-filling target).
  await expect(page.locator('.react-joyride__overlay')).toBeVisible();
  await expectNoModalAria(page);
});

test('traverses all six stops with Next/Back and finishes', async ({
  page,
}) => {
  await page.goto('/#/inbox');

  for (let i = 0; i < STOP_TITLES.length; i++) {
    await expectStop(page, i);
    await expect(page).toHaveURL(STOP_URLS[i]); // FR-002: real page navigation.
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

test('Skip closes the walk immediately', async ({ page }) => {
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test('Escape closes the walk immediately', async ({ page }) => {
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test('does not auto-run a second time within the session', async ({ page }) => {
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  // Client-side navigation away and back must not re-trigger the walk: the
  // backend `orientationDone` flag (flipped by the Skip) gates auto-run.
  await page.goto('/#/sessions');
  await page.goto('/#/inbox');
  await expect(page.locator(TOOLTIP)).toBeHidden();
});

test('replays from Settings → Advanced, ignoring the done flag', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  await page.goto('/#/settings/advanced');
  await page.getByTestId('onboarding-replay-btn').click();

  // Replay restarts from the first stop even though orientation is done.
  await expectStop(page, 0);
  await expectNoModalAria(page);
});

test('does not auto-run after a restart (reload)', async ({ page }) => {
  // The mock persists `orientationDone` to localStorage, so Skip's
  // `orientation.complete` survives a full page reload (app restart) and the
  // walk must not auto-run again.
  await page.goto('/#/inbox');
  await expectStop(page, 0);
  await page.locator(SKIP).click();
  await expect(page.locator(TOOLTIP)).toBeHidden();

  await page.reload();
  await page.goto('/#/inbox');
  await expect(page.locator(TOOLTIP)).toBeHidden();
});
