// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: Getting-started checklist (spec 056, US2 T021).
 *
 * Covers the sidebar progress-ring trigger + its non-modal flyout, built in
 * `apps/desktop/src/features/onboarding/ChecklistPopover.tsx` /
 * `ChecklistSection.tsx` and mounted by `Sidebar.tsx`. These specs deliberately
 * do NOT call `disableOnboarding` — the checklist itself is under test.
 *
 * ── The flyout is the ONLY presentation ─────────────────────────────────────
 * The checklist is no longer rendered inline in the expanded sidebar. In BOTH
 * sidebar widths it lives behind the `.alm-onb-ring` trigger and is portalled
 * to `document.body` when open, so `.alm-onb-checklist` does not exist until
 * the ring is clicked. `openChecklist()` below is the precondition for every
 * assertion here. The expanded sidebar only adds the trigger's text + count
 * (`.alm-onb-ring--labelled`); the panel itself is identical.
 *
 * ── Mock-mode coverage limit (VC-002), by design of the shared T007 mock ──
 *  Prerequisite presentation (FR-010, T019): the mock always sends
 *  `prerequisite: null`, so the reason-string + jump-link UI is implemented but
 *  not exercisable in mock mode. (Full-section auto-hide FR-031 and
 *  collapse-across-restart FR-012 ARE covered here now that the mock persists
 *  its onboarding flags + item states to localStorage — consolidation lane.)
 */

import { test, expect, seedSetupComplete, seedOnboarding, openChecklist, ONB_SECTION as SECTION, ONB_RING as RING } from "./support/harness";
import type { Page } from "@playwright/test";

const GROUP_HEADER = ".alm-onb-checklist__group-header";

function groupHeader(page: Page, label: string) {
	return page.locator(GROUP_HEADER).filter({ hasText: label });
}

/**
 * Open the checklist flyout and wait for its body.
 *
 * Clicking the ring TOGGLES, so this is a no-op when the flyout is already
 * open — callers can use it freely after a navigation (any pointerdown outside
 * the portalled panel dismisses it, so an in-app nav click always closes it).
 */
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
		await openChecklist(page);

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

	test("item tooltip reveals on pointer hover AND keyboard focus (WCAG 1.4.13)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await openChecklist(page);

		// The bespoke `#onb-tt-<id>` reveal is gone; the row wraps its label in the
		// shared base-ui `Tooltip`, which portals its popup as `.alm-tooltip`.
		//
		// #1103: that trigger span is not focusable, so the reveal is owned by the
		// row's CHECKBOX (already in the tab order). BOTH paths are asserted here —
		// asserting only hover is exactly how the keyboard path regressed unnoticed.
		const tooltip = page.locator(".alm-tooltip");
		const row = page.locator('[data-item-id="sessions.review_first"]');
		const checkbox = row.locator('[role="checkbox"]');

		await expect(tooltip).toHaveCount(0);

		// 1. Pointer hover on the label.
		await row.locator(".alm-onb-checklist__item-label").hover();
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveText(/session/i);

		// Move the pointer away so the hover reveal cannot mask the keyboard one.
		await page.mouse.move(0, 0);
		await expect(tooltip).toHaveCount(0);

		// 2. Keyboard focus on the checkbox reveals the same text.
		await checkbox.focus();
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toHaveText(/session/i);

		// 3. Dismissible without moving focus (1.4.13).
		await page.keyboard.press("Escape");
		await expect(tooltip).toHaveCount(0);
		await expect(checkbox).toBeFocused();

		// 4. Programmatically associated, so assistive tech gets the explanation
		//    even when the visual popup is closed.
		await expect(checkbox).toHaveAttribute("aria-describedby", /.+/);
	});

	test("group header toggles aria-expanded on manual click", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await openChecklist(page);

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
		await openChecklist(page);

		const sessionsGroup = page
			.locator(".alm-onb-checklist__group")
			.filter({ hasText: "Sessions" });
		// Both Sessions items are manual (non-auto) → checkable in mock mode.
		await page.getByRole("checkbox", { name: "Review a session" }).click();
		await page.getByRole("checkbox", { name: "Add a session note" }).click();

		// FR-031 precedence over FR-007: even though Sessions is the current page,
		// a complete group renders as its one-line done header (collapsed) with a
		// done marker and a done/total count. The group stays open through the
		// completion choreography first (AS-6), so this settles ~1s after the click.
		const header = groupHeader(page, "Sessions");
		await expect(header).toHaveAttribute("aria-expanded", "false", {
			timeout: 8_000,
		});
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
		// Collapse the whole sidebar (app preference) → icon mode → the bare ring
		// (no `--labelled` text) fronting the same flyout.
		await page.addInitScript(() => {
			window.localStorage.setItem(
				"alm-preferences",
				JSON.stringify({ setupCompleted: true, sidebarCollapsed: true }),
			);
		});
		await page.goto("/#/inbox");

		const ring = page.locator(RING);
		await expect(ring).toBeVisible({ timeout: 8_000 });
		await expect(ring).not.toHaveClass(/alm-onb-ring--labelled/);
		await expect(ring.getByRole("progressbar")).toBeVisible();
		// Closed: the checklist body is not mounted.
		await expect(page.locator(SECTION)).toHaveCount(0);

		// Open the non-modal popover.
		await ring.click();
		await expect(page.locator(".alm-onb-popover")).toBeVisible();
		await expect(page.locator(".alm-onb-popover").locator(SECTION)).toBeVisible();

		// The ring is a toggle: a second click closes the flyout again.
		await ring.click();
		await expect(ring).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator(".alm-onb-popover")).toHaveCount(0);

		// Non-modality: with the flyout open there is no blocking backdrop — a
		// sidebar nav item is still directly clickable and navigates.
		await ring.click();
		await expect(page.locator(".alm-onb-popover")).toBeVisible();
		await page.getByRole("link", { name: "Sessions" }).click();
		await expect(page).toHaveURL(/#\/sessions/);
	});

	test("section collapse persists across in-session navigation", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await openChecklist(page);

		// Collapse the whole Getting-started section (FR-012).
		const toggle = page.locator(".alm-onb-checklist__section-toggle");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator(".alm-onb-checklist__groups")).toHaveCount(0);

		// SPA navigation keeps the persisted collapse (mock flag round-trips).
		// Clicking outside the portalled panel also dismisses the flyout, so it
		// must be reopened to read the persisted state back.
		await page.getByRole("link", { name: "Inbox" }).click();
		await expect(page).toHaveURL(/#\/inbox/);
		await openChecklist(page);
		await expect(
			page.locator(".alm-onb-checklist__section-toggle"),
		).toHaveAttribute("aria-expanded", "false");
	});

	test("section collapse persists across an app RESTART (FR-012)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await openChecklist(page);

		// Collapse the whole section; the mock persists `sidebarCollapsed` to
		// localStorage, so it must survive a full page reload (app restart).
		const toggle = page.locator(".alm-onb-checklist__section-toggle");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");

		await page.reload();
		await openChecklist(page);
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
		await openChecklist(page);

		await page.getByRole("checkbox", { name: "Review a session" }).click();

		// The last open item settled → the backend (mock) hides the whole section,
		// which takes the flyout AND its sidebar ring trigger with it.
		await expect(page.locator(SECTION)).toHaveCount(0);
		await expect(page.locator(RING)).toHaveCount(0);
	});
});
