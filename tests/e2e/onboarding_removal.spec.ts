// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: removal + restore controls (spec 056, US5 T031).
 *
 * Covers the section-header "Remove getting started" menu + one-line confirm
 * (T029) and the Settings → Advanced restore control (T030).
 *
 * ── Mock-mode coverage limits (VC-002) ──────────────────────────────────────
 *  The remove-persists and restore-brings-back assertions need a working
 *  `onboarding_section_set` mutation AND reload persistence, both blocked in
 *  mock mode: `mocks.ts` reads `_args?.hidden`, but the binding invokes
 *  `{ request: { hidden, sidebarCollapsed } }`, so remove never flips
 *  `sectionHidden`; and `mockOnboardingFlags` re-initialises on `page.reload()`,
 *  so cross-reload persistence needs a localStorage round-trip. Both fixes are
 *  orchestrator-owned. Those tests are authored below and `test.skip`ed.
 *
 * What IS reachable now: the menu + one-line confirm copy (Paraglide keys),
 * and the Settings restore control rendering — neither needs a mutation.
 */

import { test, expect, landOnMockRoute } from "./support/harness";

const SECTION = ".alm-onb-checklist";

test.describe("onboarding removal + restore controls (spec 056 US5)", () => {
	test("header menu offers Remove with a one-line confirm using the Paraglide copy (T029)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		await page
			.getByRole("button", { name: "Getting started options" })
			.click();
		const remove = page.getByRole("menuitem", {
			name: "Remove getting started",
		});
		await expect(remove).toBeVisible();

		await remove.click();
		// One-line confirm copy comes straight from `onboarding_section_remove_confirm`.
		await expect(
			page.locator(".alm-onb-checklist__menu-confirm-text"),
		).toContainText("Remove the getting-started checklist?");
		await expect(
			page.locator(".alm-onb-checklist__menu-confirm-yes"),
		).toBeVisible();

		// Cancel closes the confirm and leaves the section in place.
		await page.locator(".alm-onb-checklist__menu-confirm-no").click();
		await expect(
			page.locator(".alm-onb-checklist__menu-confirm-text"),
		).toHaveCount(0);
		await expect(page.locator(SECTION)).toBeVisible();
	});

	test("Settings → Advanced renders the restore control with its Paraglide label (T030)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/settings/advanced");

		const restore = page.getByTestId("onboarding-restore-btn");
		await expect(restore).toBeVisible({ timeout: 8_000 });
		await expect(restore).toHaveText("Restore getting started");
		// Beside the T015 replay control in the same section.
		await expect(page.getByTestId("onboarding-replay-btn")).toBeVisible();
	});

	// TODO(consolidation): un-skip once mocks.ts reads request-wrapped args AND
	// gains localStorage persistence. `onboarding_section_set` reads
	// `_args?.hidden` but the binding invokes `{ request: { hidden } }`, so remove
	// never flips `sectionHidden`; and `mockOnboardingFlags` re-initialises on
	// reload. Both orchestrator-owned. Body complete and correct.
	test.skip("removing the section hides it (and the ring) permanently across a reload (FR-013)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		await page
			.getByRole("button", { name: "Getting started options" })
			.click();
		await page.getByRole("menuitem", { name: "Remove getting started" }).click();
		await page.locator(".alm-onb-checklist__menu-confirm-yes").click();

		await expect(page.locator(SECTION)).toHaveCount(0);
		await page.reload();
		await expect(page.locator(SECTION)).toHaveCount(0);
		await expect(page.locator(".alm-onb-ring")).toHaveCount(0);
	});

	// TODO(consolidation): depends on the same mocks.ts request-arg fix — the
	// section must be hidden (via remove) before restore has anything to bring
	// back. `onboarding_restore` itself already round-trips in the mock, so once
	// remove works this exercises the full remove→restore round-trip. Body
	// complete and correct.
	test.skip("restore brings the section back with re-derived pre-ticked state (FR-014)", async ({
		page,
	}) => {
		await landOnMockRoute(page, "/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible({ timeout: 8_000 });

		// Remove it …
		await page
			.getByRole("button", { name: "Getting started options" })
			.click();
		await page.getByRole("menuitem", { name: "Remove getting started" }).click();
		await page.locator(".alm-onb-checklist__menu-confirm-yes").click();
		await expect(page.locator(SECTION)).toHaveCount(0);

		// … then restore from Settings → Advanced.
		await page.goto("/#/settings/advanced");
		await page.getByTestId("onboarding-restore-btn").click();
		await page.goto("/#/sessions");
		await expect(page.locator(SECTION)).toBeVisible();
	});
});
