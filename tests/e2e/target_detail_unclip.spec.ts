// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression pin — #816 ("Target detail panel: aliases/notes/coverage/links/
 * back-button silently clipped by DetailPane fill-mode overflow:hidden"):
 * `DetailPane fill` (primitives.css `.alm-detail--fill`) sets `overflow:
 * hidden` on the pane itself and expects exactly one descendant to establish
 * its own `overflow-y: auto` scroll region. `TargetDetailV2` used to dump all
 * of its post-header content as flat siblings with no such region, so
 * everything below the altitude graph — including the back button — sat
 * beyond the pane's clipped bottom edge with NO way for a mouse-wheel user to
 * ever scroll it into view (an `overflow:hidden` box is not wheel-scrollable,
 * unlike `overflow:auto`/`scroll`). Fixed by wrapping that content in
 * `.alm-planner__scroll` (`flex:1; min-height:0; overflow-y:auto`,
 * redesign-detail.css).
 *
 * IMPORTANT: this deliberately drives a real mouse-wheel event
 * (`page.mouse.wheel`) rather than `locator.scrollIntoViewIfNeeded()` /
 * `Element.scrollIntoView()`. The latter are scripted and, per the CSSOM View
 * spec, will happily set `scrollTop` on an `overflow:hidden` ancestor too —
 * so they'd report the button "visible" even with the pre-fix CSS, silently
 * defeating this regression pin. A wheel event only moves content inside a
 * true `overflow:auto`/`scroll` region, exactly like a real user's scroll
 * gesture, so it actually distinguishes the fixed layout from the clipped one.
 *
 * Verification layer: PE — Playwright mocks-UI (run in WSL).
 */
import type { Locator } from "@playwright/test";
import {
	disableGuidedTourOverlay,
	expect,
	seedSetupComplete,
	test,
} from "./support/harness";

/** `locator.boundingBox()` types as nullable; every call site here expects the
 * element to be laid out (it's already asserted present), so fail loudly
 * instead of asserting away the null. */
async function requireBox(locator: Locator) {
	const box = await locator.boundingBox();
	if (box === null) {
		throw new Error("expected a bounding box, element is not laid out");
	}
	return box;
}

test.describe("Regression · Target detail pane content unclipped (#816)", () => {
	test("mouse-wheel scrolling the detail pane reveals the back button below the altitude graph", async ({
		page,
	}) => {
		// Short enough that the header + pill row + altitude graph alone fill the
		// pane — pre-fix this pushed the back button out under overflow:hidden
		// with no scrollable region to wheel it back into view.
		await page.setViewportSize({ width: 1100, height: 620 });
		seedSetupComplete(page);
		await page.goto("/#/targets");
		await disableGuidedTourOverlay(page);

		const m31 = page.locator(".alm-targets-table__row", { hasText: "M 31" });
		await expect(m31).toBeVisible({ timeout: 8_000 });
		await m31.click();

		const pane = page.locator(".alm-detail--fill");
		const scrollRegion = page.locator(".alm-planner__scroll");
		await expect(scrollRegion).toBeVisible();

		const backBtn = page.getByRole("button", { name: "← All targets" });
		const beforeBox = await requireBox(backBtn);
		const paneBox = await requireBox(pane);
		// Before scrolling, the back button (last element in the region) sits
		// below the pane's own clipped bottom edge — this holds both pre- and
		// post-fix, since it's the natural (unscrolled) layout position.
		expect(beforeBox.y).toBeGreaterThan(paneBox.y + paneBox.height);

		// Real wheel scroll over the scroll region, as an actual user would do.
		const scrollBox = await requireBox(scrollRegion);
		await page.mouse.move(
			scrollBox.x + scrollBox.width / 2,
			scrollBox.y + scrollBox.height / 2,
		);
		await page.mouse.wheel(0, 3000);

		// Post-fix, the wheel scroll moves the button up into the pane's
		// clipped viewport — it now overlaps the pane's own bounding box.
		await expect(async () => {
			const afterBox = await requireBox(backBtn);
			expect(afterBox.y).toBeLessThan(paneBox.y + paneBox.height);
			expect(afterBox.y + afterBox.height).toBeGreaterThan(paneBox.y);
		}).toPass({ timeout: 2_000 });
		await expect(backBtn).toBeVisible();
		await expect(backBtn).toBeEnabled();
	});
});
