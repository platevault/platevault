// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: Getting-started checklist (spec 056, US2 T021).
 *
 * Covers the sidebar accordion + icon-collapsed popover built in
 * `apps/desktop/src/features/onboarding/ChecklistSection.tsx` /
 * `ChecklistPopover.tsx` and mounted by `Sidebar.tsx`. These specs deliberately
 * do NOT call `disableOnboarding` — the checklist itself is under test.
 *
 * ── Mock-mode coverage limit (VC-002), by design of the shared T007 mock ──
 *  Prerequisite presentation (FR-010, T019): the mock always sends
 *  `prerequisite: null`, so the reason-string + jump-link UI is implemented but
 *  not exercisable in mock mode. (Full-section auto-hide FR-031 and
 *  collapse-across-restart FR-012 ARE covered here now that the mock persists
 *  its onboarding flags + item states to localStorage — consolidation lane.)
 */

import { test, expect, seedSetupComplete, seedOnboarding } from "./support/harness";
import type { Page } from "@playwright/test";

const SECTION = ".alm-onb-checklist";
const GROUP_HEADER = ".alm-onb-checklist__group-header";

function groupHeader(page: Page, label: string) {
	return page.locator(GROUP_HEADER).filter({ hasText: label });
}

test.describe("onboarding getting-started checklist (spec 056 US2)", () => {
	// US2 exercises the checklist, not the US1 walk. Seed orientation as already
	// done so the walk never auto-launches its overlay over the checklist — but
	// leave onboarding enabled (not `disableOnboarding`) so the section renders.
	test.beforeEach(({ page }) => {
		seedOnboarding(page, { flags: { orientationDone: true } });
	});

	test("current-route group auto-expands; others are one-line with counts", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		// Sessions is the current route → its group is expanded and its items show.
		const sessions = groupHeader(page, "Sessions");
		await expect(sessions).toHaveAttribute("aria-expanded", "true");
		await expect(
			page.getByRole("checkbox", { name: "Review a session" }),
		).toBeVisible();
		await expect(
			page.getByRole("checkbox", { name: "Add a session note" }),
		).toBeVisible();

		// A non-current group is a one-line header: collapsed, with a done/total
		// count, and its items are not rendered.
		const inbox = groupHeader(page, "Inbox");
		await expect(inbox).toHaveAttribute("aria-expanded", "false");
		await expect(inbox).toContainText("0/2");
		await expect(
			page.getByRole("checkbox", { name: "Apply your first plan" }),
		).toHaveCount(0);
	});

	test("item tooltip reveals on keyboard focus (WCAG 1.4.13)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		const tooltip = page.locator("#onb-tt-sessions_review_first");
		await expect(tooltip).toBeHidden();
		await page.getByRole("checkbox", { name: "Review a session" }).focus();
		await expect(tooltip).toBeVisible();
	});

	test("group header toggles aria-expanded on manual click", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		// Manually collapse the auto-expanded current group.
		const sessions = groupHeader(page, "Sessions");
		await sessions.click();
		await expect(sessions).toHaveAttribute("aria-expanded", "false");

		// Manually expand a non-current group (override wins over the route rule).
		const inbox = groupHeader(page, "Inbox");
		await inbox.click();
		await expect(inbox).toHaveAttribute("aria-expanded", "true");
	});

	test("completing every item in a group collapses it to a one-line done header (FR-031)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		const sessionsGroup = page
			.locator(".alm-onb-checklist__group")
			.filter({ hasText: "Sessions" });
		// Both Sessions items are manual (non-auto) → checkable in mock mode.
		await page.getByRole("checkbox", { name: "Review a session" }).click();
		await page.getByRole("checkbox", { name: "Add a session note" }).click();

		// FR-031 precedence over FR-007: even though Sessions is the current page,
		// a complete group renders as its one-line done header (collapsed) with a
		// done marker and a done/total count.
		const header = groupHeader(page, "Sessions");
		await expect(header).toHaveAttribute("aria-expanded", "false");
		await expect(header).toContainText("2/2");
		await expect(
			sessionsGroup.locator(".alm-onb-checklist__group-done"),
		).toBeVisible();
		await expect(
			page.getByRole("checkbox", { name: "Review a session" }),
		).toHaveCount(0);

		// The manual accordion toggle still works on a complete group.
		await header.click();
		await expect(header).toHaveAttribute("aria-expanded", "true");
	});

	test("icon-collapsed sidebar shows a progress ring that opens a non-modal popover", async ({
		page,
	}) => {
		seedSetupComplete(page);
		// Collapse the whole sidebar (app preference) → icon mode → ring + popover.
		await page.addInitScript(() => {
			window.localStorage.setItem(
				"alm-preferences",
				JSON.stringify({ setupCompleted: true, sidebarCollapsed: true }),
			);
		});
		await page.goto("/#/inbox");

		const ring = page.locator(".alm-onb-ring");
		await expect(ring).toBeVisible({ timeout: 8_000 });
		await expect(ring.getByRole("progressbar")).toBeVisible();
		// Closed: the checklist body is not mounted.
		await expect(page.locator(SECTION)).toHaveCount(0);

		// Open the non-modal popover.
		await ring.click();
		await expect(page.locator(".alm-onb-popover")).toBeVisible();
		await expect(page.locator(".alm-onb-popover").locator(SECTION)).toBeVisible();

		// Non-modality: no blocking backdrop — a sidebar nav item is still
		// interactive while the popover is open.
		await page.getByRole("link", { name: "Sessions" }).click();
		await expect(page).toHaveURL(/#\/sessions/);

		// Toggling the ring closes the popover.
		await ring.click();
		await expect(page.locator(".alm-onb-popover")).toHaveCount(0);
	});

	test("section collapse persists across in-session navigation", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		const toggle = page.locator(".alm-onb-checklist__section-toggle");
		await expect(toggle).toBeVisible({ timeout: 8_000 });

		// Collapse the whole Getting-started section (FR-012).
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator(".alm-onb-checklist__groups")).toHaveCount(0);

		// SPA navigation keeps the persisted collapse (mock flag round-trips).
		await page.getByRole("link", { name: "Inbox" }).click();
		await expect(page).toHaveURL(/#\/inbox/);
		await expect(
			page.locator(".alm-onb-checklist__section-toggle"),
		).toHaveAttribute("aria-expanded", "false");
	});

	test("section collapse persists across an app RESTART (FR-012)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		const toggle = page.locator(".alm-onb-checklist__section-toggle");
		await expect(toggle).toBeVisible({ timeout: 8_000 });

		// Collapse the whole section; the mock persists `sidebarCollapsed` to
		// localStorage, so it must survive a full page reload (app restart).
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");

		await page.reload();
		await expect(
			page.locator(".alm-onb-checklist__section-toggle"),
		).toHaveAttribute("aria-expanded", "false");
	});

	test("whole section auto-hides once the last open item settles (FR-031)", async ({
		page,
	}) => {
		// Seed every item settled EXCEPT one open manual item; settling it makes
		// the mock flip `sectionHidden` (FR-031 completion auto-hide), so the whole
		// section unmounts. Auto-tick items can't be checked via the UI in mock
		// mode, so they must be pre-settled through the seed.
		seedOnboarding(page, {
			flags: { orientationDone: true },
			items: {
				"inbox.confirm_first": { state: "auto_checked", source: "event" },
				"inbox.apply_first_plan": { state: "auto_checked", source: "event" },
				"sessions.add_note": { state: "manually_checked", source: "user" },
				"calibration.match_master": {
					state: "manually_checked",
					source: "user",
				},
				"calibration.review_masters": {
					state: "manually_checked",
					source: "user",
				},
				"targets.resolve_first": { state: "auto_checked", source: "event" },
				"targets.add_favourite": { state: "manually_checked", source: "user" },
				"projects.create_first": { state: "auto_checked", source: "event" },
				"projects.launch_tool": { state: "auto_checked", source: "event" },
				"projects.review_artifacts": {
					state: "manually_checked",
					source: "user",
				},
				// sessions.review_first left unchecked — the last open item.
			},
		});
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		await page.getByRole("checkbox", { name: "Review a session" }).click();

		// The last open item settled → the backend (mock) hides the whole section.
		await expect(page.locator(SECTION)).toHaveCount(0);
	});
});
