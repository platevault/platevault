// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: Adaptive detail-panel dock CI validation lane
 * (spec 054 FR-016/SC-009, T029). Asserts the FR-016 set directly against the
 * shared mechanism (`ListPageLayout`/`useDetailDock`/`data/preferences.ts`):
 *
 *   1. Side-dock engage/disengage across the wide/narrow threshold, with
 *      selection preserved through the flip (Sessions — default 1400px
 *      threshold; the shared mechanism, not page-specific logic).
 *   2. A per-page placement pin (Bottom, then Right) persists across a
 *      simulated restart (`page.reload()` — the mock app rehydrates its
 *      `alm-preferences` localStorage on boot, same as a real restart would
 *      rehydrate from the persisted store).
 *   3. Dragging the resize handle changes the side-panel width and the width
 *      persists across restart.
 *   4. Inbox's permanent detail-dominant split renders at every tested width
 *      (never a bottom dock) with a narrow list + full-height detail.
 *   5. Targets beside a side dock (1500px threshold): the pinned star +
 *      designation columns stay visible while the rest of the table scrolls.
 *
 * Sessions (not Targets) is used for the threshold/pin/resize assertions —
 * Targets' astronomy-gated mock catalog is reliable in this harness too (see
 * `targets_planner.spec.ts`), but Sessions has zero site-gate/date
 * preconditions, keeping those assertions focused on the shared mechanism
 * rather than Targets-specific setup.
 */
import {
	test,
	expect,
	seedSetupComplete,
	disableGuidedTourOverlay,
} from "./support/harness";

const WIDE = { width: 1600, height: 900 };
const NARROW = { width: 1100, height: 720 };
// Targets' threshold is 1500 (TARGETS_DOCK_THRESHOLD) — wider than the shared
// 1400 default (DEFAULT_DOCK_THRESHOLD) — so 1500 alone doesn't guarantee a
// side dock on every page; use a width past both thresholds for Targets.
const TARGETS_WIDE = { width: 1550, height: 900 };

/** Read the raw `alm-preferences` blob the mock app persists to localStorage. */
async function readPreferences(
	page: import("@playwright/test").Page,
): Promise<Record<string, unknown>> {
	return page.evaluate(() => {
		const raw = window.localStorage.getItem("alm-preferences");
		return raw ? JSON.parse(raw) : {};
	});
}

/**
 * `seedSetupComplete` (harness.ts) unconditionally OVERWRITES the whole
 * `alm-preferences` blob on every navigation — fine for specs that never
 * reload, but `page.addInitScript` reruns on `page.reload()` too, so it would
 * silently wipe a `detailDock` pin the app just persisted right before the
 * "restart" the persistence tests below simulate. This merging variant reads
 * whatever is already there (including the pin the UI wrote) and only adds
 * `setupCompleted`, so a reload is a faithful restart-and-rehydrate rather
 * than a preference reset.
 */
function seedSetupCompleteMerging(page: import("@playwright/test").Page): void {
	page.addInitScript(() => {
		const raw = window.localStorage.getItem("alm-preferences");
		const existing = raw ? JSON.parse(raw) : {};
		window.localStorage.setItem(
			"alm-preferences",
			JSON.stringify({ ...existing, setupCompleted: true }),
		);
	});
}

test.describe("adaptive detail-panel dock (spec 054 FR-016/SC-009)", () => {
	test("1 · side dock engages at/above the threshold and disengages below it, preserving selection (Sessions)", async ({
		page,
	}) => {
		await page.setViewportSize(WIDE);
		seedSetupComplete(page);
		await page.goto("/#/sessions");
		await disableGuidedTourOverlay(page);

		const row = page.locator(".alm-sessions-table__row").first();
		await expect(row).toBeVisible({ timeout: 8_000 });
		await row.click();

		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);
		await expect(row).toHaveClass(/alm-sessions-table__row--selected/);

		// Cross the threshold downward — the panel re-docks to bottom without
		// losing the selection (spec US2 acceptance scenario 3).
		await page.setViewportSize(NARROW);
		await expect(detail).not.toHaveClass(/alm-listpage__detail--side/);
		await expect(detail).toBeVisible();
		await expect(row).toHaveClass(/alm-sessions-table__row--selected/);

		// …and back up re-engages the side dock, selection still intact.
		await page.setViewportSize(WIDE);
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);
		await expect(row).toHaveClass(/alm-sessions-table__row--selected/);
	});

	test("2a · a 'Bottom' placement pin persists across a restart, even at a wide width (Sessions)", async ({
		page,
	}) => {
		await page.setViewportSize(WIDE);
		seedSetupCompleteMerging(page);
		await page.goto("/#/sessions");
		await disableGuidedTourOverlay(page);

		const row = page.locator(".alm-sessions-table__row").first();
		await expect(row).toBeVisible({ timeout: 8_000 });
		await row.click();

		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);

		const placementControl = page.locator(".alm-listpage__detail-placement");
		await placementControl.getByRole("button", { name: "Bottom" }).click();
		await expect(detail).not.toHaveClass(/alm-listpage__detail--side/);

		// Simulated restart: the mock app rehydrates from localStorage on load.
		await page.reload();
		await disableGuidedTourOverlay(page);
		await row.click();
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).not.toHaveClass(
			/alm-listpage__detail--side/,
		);
	});

	test("2b · a 'Right' placement pin persists across a restart (Sessions)", async ({
		page,
	}) => {
		await page.setViewportSize(WIDE);
		seedSetupCompleteMerging(page);
		await page.goto("/#/sessions");
		await disableGuidedTourOverlay(page);

		const row = page.locator(".alm-sessions-table__row").first();
		await expect(row).toBeVisible({ timeout: 8_000 });
		await row.click();

		const detail = page.locator(".alm-listpage__detail");
		const placementControl = page.locator(".alm-listpage__detail-placement");
		await placementControl.getByRole("button", { name: "Right" }).click();
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);

		await page.reload();
		await disableGuidedTourOverlay(page);
		await row.click();
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);

		// Distinguish a genuine PIN from the adaptive heuristic coincidentally
		// also resolving to 'side' at this same width: read the persisted mode
		// directly rather than re-deriving placement from a width flip (a
		// pinned 'side' can itself fall back to bottom below research.md D3's
		// table-floor, so re-testing via width isn't a reliable proxy for "the
		// mode is still 'side'").
		const persisted = await readPreferences(page);
		expect(
			(persisted as { detailDock?: { sessions?: { mode?: string } } })
				.detailDock?.sessions?.mode,
		).toBe("side");
	});

	test("3 · dragging the resize handle changes the side-panel width and it persists across a restart (Sessions)", async ({
		page,
	}) => {
		await page.setViewportSize(WIDE);
		seedSetupCompleteMerging(page);
		await page.goto("/#/sessions");
		await disableGuidedTourOverlay(page);

		const row = page.locator(".alm-sessions-table__row").first();
		await expect(row).toBeVisible({ timeout: 8_000 });
		await row.click();
		await expect(page.locator(".alm-listpage__detail")).toHaveClass(
			/alm-listpage__detail--side/,
		);

		const before = await readPreferences(page);
		const beforeWidth = (
			before as { detailDock?: { sessions?: { width?: number } } }
		).detailDock?.sessions?.width;
		// Default sessions side width (DEFAULT_DOCK_WIDTH.sessions) when no drag
		// has happened yet — the pin set in tests 2a/2b above runs in an
		// isolated page/context, so this test starts from a clean localStorage.
		expect(beforeWidth ?? 420).toBe(420);

		const handle = page.locator(".alm-listpage__resize-handle");
		await expect(handle).toBeVisible();
		const box = await handle.boundingBox();
		if (!box) throw new Error("resize handle has no bounding box");

		// The side panel is anchored to the right edge; dragging the handle LEFT
		// grows it (DockResizeHandle `grow: 'left'`).
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
		await page.mouse.up();

		const after = await readPreferences(page);
		const afterWidth = (
			after as { detailDock?: { sessions?: { width?: number } } }
		).detailDock?.sessions?.width;
		expect(afterWidth).toBeGreaterThan(beforeWidth ?? 420);

		await page.reload();
		await disableGuidedTourOverlay(page);
		await row.click();
		const reloaded = await readPreferences(page);
		const reloadedWidth = (
			reloaded as { detailDock?: { sessions?: { width?: number } } }
		).detailDock?.sessions?.width;
		expect(reloadedWidth).toBe(afterWidth);
	});

	test("4a · Inbox renders the permanent detail-dominant split at a NARROW width — never a bottom dock", async ({
		page,
	}) => {
		await page.setViewportSize(NARROW);
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);

		await expect(page.getByTestId("inbox-list")).toBeVisible({
			timeout: 8_000,
		});
		// The list column is split-narrow even before a selection (the split
		// shape is permanent, independent of `hasDetail`).
		await expect(page.locator(".alm-listpage__main--split")).toBeVisible();

		await page.getByTestId("inbox-item-item-001").click();
		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toHaveClass(/alm-listpage__detail--split/);
		await expect(detail).not.toHaveClass(/alm-listpage__detail--side/);
	});

	test("4b · Inbox renders the permanent detail-dominant split at a WIDE width — never a bottom dock", async ({
		page,
	}) => {
		await page.setViewportSize(WIDE);
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);

		await expect(page.getByTestId("inbox-list")).toBeVisible({
			timeout: 8_000,
		});
		await expect(page.locator(".alm-listpage__main--split")).toBeVisible();

		await page.getByTestId("inbox-item-item-001").click();
		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toHaveClass(/alm-listpage__detail--split/);
		await expect(detail).not.toHaveClass(/alm-listpage__detail--side/);
	});

	test("5 · Targets beside a side dock: pinned star + designation columns stay visible while the rest scrolls", async ({
		page,
	}) => {
		await page.setViewportSize(TARGETS_WIDE);
		seedSetupComplete(page);
		await page.goto("/#/targets");
		await disableGuidedTourOverlay(page);

		const m31 = page.locator(".alm-targets-table__row", { hasText: "M 31" });
		await expect(m31).toBeVisible({ timeout: 8_000 });
		await m31.click();

		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toHaveClass(/alm-listpage__detail--side/);

		// The pinned identity cells are visible for the selected row…
		await expect(m31.locator(".alm-targets-pin-star")).toBeVisible();
		await expect(m31.locator(".alm-targets-pin-designation")).toBeVisible();

		// …and the table's scroll container needs horizontal scroll now that a
		// side dock has narrowed the available table width (the existing
		// full-width no-scroll pin at 1100×720 with NO side dock is asserted
		// unchanged by targets_planner.spec.ts:531/:536).
		const scroller = page.locator(".alm-targets-table__scroll");
		await expect(scroller).toBeVisible();
		expect(
			await scroller.evaluate((el) => el.scrollWidth > el.clientWidth),
		).toBe(true);
	});
});
