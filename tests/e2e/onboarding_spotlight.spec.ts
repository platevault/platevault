// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: Find-It spotlight (spec 056, US4 T028; FR-022/FR-023).
 *
 * Exercises `FindSpotlight.tsx` (single-step non-modal joyride) and the row find
 * affordance wired in `ChecklistSection.tsx`. None of this needs a backend
 * mutation — the spotlight is client-side UI over the seeded (unchecked) items
 * and real page anchors — so the full dismissal matrix, the no-timer guarantee,
 * cross-page navigation, and reduced-motion pulse suppression are all
 * exercisable in mock mode NOW.
 *
 * Anchor choice: `projects.create_first → projects.create-cta` (the "New
 * project" button) is unconditionally rendered on `/projects`, so the spotlight
 * always resolves. `inbox.confirm-row` is gated behind `canBulkConfirm` and is
 * deliberately NOT relied on here.
 *
 * `landOnMockRoute` first clears the US1 orientation walk, whose modal overlay
 * would otherwise intercept every click on these surfaces.
 */

import {
  test,
  expect,
  landOnMockRoute,
  openChecklist,
  seedEmptyInventory,
  seedOnboardingUnmet,
} from './support/harness';
import type { Page } from '@playwright/test';

const OVERLAY = '.react-joyride__overlay';
const SPOTLIGHT = '.react-joyride__spotlight';
const CREATE_CTA = '[data-guide-anchor="projects.create-cta"]';
const RESOLVE_CTA = '[data-guide-anchor="targets.resolve-cta"]';
const NOTE_FIELD = '[data-guide-anchor="sessions.note-field"]';
const REVIEW_MASTER_ROW = '[data-guide-anchor="calibration.review-row"]';

/**
 * Open the checklist flyout and wait for its body (no-op when already open).
 *
 * The checklist — and therefore every row find affordance — is only mounted
 * inside the `.pv-onb-ring` flyout, portalled to `document.body`.
 */
function findBtn(page: Page, itemId: string) {
  return page
    .locator(`[data-item-id="${itemId}"]`)
    .getByRole('button', { name: /Show me where/ });
}

test.describe('onboarding find-it spotlight (spec 056 US4)', () => {
  test('activating find spotlights the real control non-modally and presses the affordance', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    const btn = findBtn(page, 'projects.create_first');
    await expect(btn).toBeVisible({ timeout: 8_000 });

    await btn.click();

    // Spotlight is up over the real control; the affordance shows pressed.
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(SPOTLIGHT)).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    // Non-modal: the spotlit control is still on the page and interactive.
    await expect(page.locator(CREATE_CTA)).toBeVisible();
  });

  // ── Dismissal matrix: all five paths (FR-023) ──────────────────────────────
  test('dismiss by clicking the spotlighted target', async ({ page }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await page.locator(CREATE_CTA).click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('dismiss by clicking the dimmed overlay (anywhere else)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await page.locator(OVERLAY).click({ position: { x: 5, y: 5 } });
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('dismiss with Escape', async ({ page }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('dismiss by toggling the find affordance again', async ({ page }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    const btn = findBtn(page, 'projects.create_first');
    await btn.click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await btn.click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('dismiss by changing pages', async ({ page }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    // The overlay dims the nav rail, so a route change here is a programmatic
    // navigation (a real one could also be the target-click flow). The
    // route-change dismissal effect fires regardless of the trigger.
    await page.evaluate(() => {
      window.location.hash = '#/inbox';
    });
    await expect(page).toHaveURL(/#\/inbox/);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('never dismisses on a timer (FR-023)', async ({ page }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    // Well past the pulse window (2.5s): the outline settles static but the
    // spotlight itself must persist indefinitely.
    await page.waitForTimeout(3_500);
    await expect(page.locator(OVERLAY)).toBeVisible();
  });

  test("cross-page find navigates to the item's page, then spotlights (FR-022)", async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/inbox');
    await openChecklist(page);
    // The projects group is a one-line header off its own page — expand it so
    // its rows (and their find affordances) render.
    await page
      .locator('[data-testid="onb-checklist-group-header"]')
      .filter({ hasText: 'Projects' })
      .click();

    await findBtn(page, 'projects.create_first').click();

    await expect(page).toHaveURL(/#\/projects/);
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(CREATE_CTA)).toBeVisible();
  });

  test('unavailable-target items explain why instead of spotlighting nothing', async ({
    page,
  }) => {
    // `sessions.add_note` used to be this test's example of an unresolvable
    // target: its `sessions.note-field` anchor lives on a session DETAIL pane,
    // and the spotlight only ever navigated to the sessions LIST, so it always
    // timed out. It now deep-links to a real session, so the honest remaining
    // unresolvable case is the one that no longer has a record to link TO: an
    // empty library. That is a genuine dead end, not a weakened assertion —
    // there is no note field anywhere to point at.
    seedEmptyInventory(page);
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);
    await findBtn(page, 'sessions.add_note').click();

    const callout = page.locator('[data-testid="onb-spotlight-unavailable"]');
    await expect(callout).toBeVisible({ timeout: 8_000 });
    await expect(callout).toContainText('Nothing to point at');
    // No joyride spotlight was drawn.
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('sessions.add_note deep-links to a session and spotlights its note field', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    await findBtn(page, 'sessions.add_note').click();

    // The list route can never show the note field — the spotlight must select
    // a real session first (`/sessions/$id` redirects to `?selected=<id>`).
    await expect(page).toHaveURL(/selected=/, { timeout: 8_000 });
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(NOTE_FIELD)).toBeVisible();
  });

  test("a blocked item spotlights its prerequisite's control and says so", async ({
    page,
  }) => {
    // `targets.add_favourite` is blocked on `targets.resolve_first`, whose
    // control is the "Add target" CTA. Its own favourite toggle cannot help
    // until a target exists, so "show me where" answers with what to do first.
    seedOnboardingUnmet(page, ['targets.add_favourite']);
    await landOnMockRoute(page, '/#/targets');
    await openChecklist(page);

    const btn = findBtn(page, 'targets.add_favourite');
    // The affordance is offered on a blocked row — it used to be hidden.
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();

    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(RESOLVE_CTA)).toBeVisible();
    // The tooltip names the upstream item as the thing to do first, while its
    // title still names the row the user actually asked about.
    const tooltip = page.locator('[data-testid="onboarding-tooltip"]');
    await expect(tooltip).toContainText('is required first');
    await expect(tooltip.locator('[data-testid="onboarding-tooltip-title"]')).toHaveText(
      'Add a favourite target',
    );
  });

  test('every registry item offers find; review masters spotlights its first row', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/calibration');
    await openChecklist(page);

    const btn = findBtn(page, 'calibration.review_masters');
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await btn.click();

    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(REVIEW_MASTER_ROW)).toBeVisible();
  });

  test('normal motion pulses the spotlight outline for the first seconds', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    // The component signals the pulse via a root data-attribute.
    await expect(page.locator('html')).toHaveAttribute(
      'data-onb-spotlight-pulse',
      'on',
    );
  });
});

test.describe('onboarding find-it spotlight — reduced motion (VC-002)', () => {
  // `reducedMotion` moved out of the top-level `PlaywrightTestOptions` type
  // in @playwright/test 1.61.1 (still a real BrowserContextOptions field,
  // still applied at runtime) — set it via the `contextOptions` escape hatch
  // instead of the removed direct property.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('reduced motion suppresses the spotlight pulse (static outline only)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/projects');
    await openChecklist(page);
    await findBtn(page, 'projects.create_first').click();

    // The spotlight still renders (static outline) …
    await expect(page.locator(OVERLAY)).toBeVisible();
    // … but the pulse signal is never raised.
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-onb-spotlight-pulse',
      'on',
    );
  });
});
