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

import { test, expect, landOnMockRoute } from "./support/harness";
import type { Page } from "@playwright/test";

const OVERLAY = ".react-joyride__overlay";
const SPOTLIGHT = ".react-joyride__spotlight";
const CREATE_CTA = '[data-guide-anchor="projects.create-cta"]';

function findBtn(page: Page, itemId: string) {
	return page
		.locator(`[data-item-id="${itemId}"]`)
		.getByRole("button", { name: /Show me where/ });
}

test.describe("onboarding find-it spotlight (spec 056 US4)", () => {
	test("activating find spotlights the real control non-modally and presses the affordance", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/projects");
		const btn = findBtn(page, "projects.create_first");
		await expect(btn).toBeVisible({ timeout: 8_000 });

		await btn.click();

		// Spotlight is up over the real control; the affordance shows pressed.
		await expect(page.locator(OVERLAY)).toBeVisible();
		await expect(page.locator(SPOTLIGHT)).toBeVisible();
		await expect(btn).toHaveAttribute("aria-pressed", "true");
		// Non-modal: the spotlit control is still on the page and interactive.
		await expect(page.locator(CREATE_CTA)).toBeVisible();
	});

	// ── Dismissal matrix: all five paths (FR-023) ──────────────────────────────
	test("dismiss by clicking the spotlighted target", async ({ page }) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		await page.locator(CREATE_CTA).click();
		await expect(page.locator(OVERLAY)).toHaveCount(0);
	});

	test("dismiss by clicking the dimmed overlay (anywhere else)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		await page.locator(OVERLAY).click({ position: { x: 5, y: 5 } });
		await expect(page.locator(OVERLAY)).toHaveCount(0);
	});

	test("dismiss with Escape", async ({ page }) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(OVERLAY)).toHaveCount(0);
	});

	test("dismiss by toggling the find affordance again", async ({ page }) => {
		await landOnMockRoute(page, "/#/projects");
		const btn = findBtn(page, "projects.create_first");
		await btn.click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		await btn.click();
		await expect(page.locator(OVERLAY)).toHaveCount(0);
		await expect(btn).toHaveAttribute("aria-pressed", "false");
	});

	test("dismiss by changing pages", async ({ page }) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		// The overlay dims the nav rail, so a route change here is a programmatic
		// navigation (a real one could also be the target-click flow). The
		// route-change dismissal effect fires regardless of the trigger.
		await page.evaluate(() => {
			window.location.hash = "#/inbox";
		});
		await expect(page).toHaveURL(/#\/inbox/);
		await expect(page.locator(OVERLAY)).toHaveCount(0);
	});

	test("never dismisses on a timer (FR-023)", async ({ page }) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		// Well past the pulse window (2.5s): the outline settles static but the
		// spotlight itself must persist indefinitely.
		await page.waitForTimeout(3_500);
		await expect(page.locator(OVERLAY)).toBeVisible();
	});

	test("cross-page find navigates to the item's page, then spotlights (FR-022)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/inbox");
		// The projects group is a one-line header off its own page — expand it so
		// its rows (and their find affordances) render.
		await page
			.locator(".alm-onb-checklist__group-header")
			.filter({ hasText: "Projects" })
			.click();

		await findBtn(page, "projects.create_first").click();

		await expect(page).toHaveURL(/#\/projects/);
		await expect(page.locator(OVERLAY)).toBeVisible();
		await expect(page.locator(CREATE_CTA)).toBeVisible();
	});

	test("unavailable-target items explain why instead of spotlighting nothing", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/sessions");
		// `sessions.add_note` has no on-page control anchor → unavailable state.
		await findBtn(page, "sessions.add_note").click();

		const callout = page.locator(".alm-onb-spotlight-unavailable");
		await expect(callout).toBeVisible();
		await expect(callout).toContainText("isn't on screen");
		// No joyride spotlight was drawn.
		await expect(page.locator(OVERLAY)).toHaveCount(0);
	});

	test("normal motion pulses the spotlight outline for the first seconds", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();
		await expect(page.locator(OVERLAY)).toBeVisible();

		// The component signals the pulse via a root data-attribute.
		await expect(page.locator("html")).toHaveAttribute(
			"data-onb-spotlight-pulse",
			"on",
		);
	});
});

test.describe("onboarding find-it spotlight — reduced motion (VC-002)", () => {
	test.use({ reducedMotion: "reduce" });

	test("reduced motion suppresses the spotlight pulse (static outline only)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/projects");
		await findBtn(page, "projects.create_first").click();

		// The spotlight still renders (static outline) …
		await expect(page.locator(OVERLAY)).toBeVisible();
		// … but the pulse signal is never raised.
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-onb-spotlight-pulse",
			"on",
		);
	});
});
