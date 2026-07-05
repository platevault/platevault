/**
 * Playwright mock-e2e: Inbox ingest → reclassify → confirm (spec 041, the
 * "Inbox universal gate" — Journeys 2/3 of the E2E revalidation Phase B,
 * Batch 1). This journey previously had ZERO Playwright coverage (see
 * `docs/development/e2e-mock-coverage-audit-2026-07-05.md`).
 *
 * Fixture data (apps/desktop/src/api/mocks.ts `mockInvoke` case 'inbox_list'):
 *   item-001        · "2025-10-10/NGC7000"                · state=classified            · classify() → MIXED (16 light · 2 dark, 1 unclassified file)
 *   item-002        · "2025-10-10/darks"                  · state=pending_classification · classify() → single_type "dark"
 *   item-master-dark· "2025-10-10/darks/masterDark_*.xisf"· isMaster, masterFrameType=dark
 *   item-003        · "2025-11-01/Jupiter" (video lane)   · state=pending_classification · classify() → single_type "dark" (mock always returns "dark" for non-mixed ids)
 * All four items' `organizationState` is "unorganized" (the fixture has no
 * "organized" item), and `inbox_classify` only ever returns type: 'mixed' for
 * the literal id "item-001" — every other id resolves to single_type/"dark"
 * regardless of its real content. Tests below are written against these exact,
 * static shapes rather than inferred ones.
 *
 * ── Known mock-layer gaps (verified against `apps/desktop/src/api/mocks.ts`,
 *    NOT fixed here — this batch is additive-tests-only, no product code) ──
 *
 * `mockInvoke`'s switch has no case for: `inbox_plan_list_open`,
 * `inbox_item_metadata`, `inbox_plan`, `inbox_plan_apply`,
 * `inbox_plan_apply_all`, `inbox_plan_apply_selected`, `inbox_plan_cancel`,
 * `inbox_stats`, `inbox_property_registry`. Each falls through to `default:
 * throw new Error('Unknown mock command: ...')`. Concretely, in mock mode:
 *   - `useOpenInboxPlans` (InboxPage) always resolves to `{ data: null }` (the
 *     rejection is swallowed into hook-local error state), so `openPlans` is
 *     always `[]` and the top-bar "Review plans" trigger NEVER renders —
 *     the plan-approval overlay (`PlanApprovalOverlay`/`PlanPanel`) is
 *     unreachable end-to-end in mock mode today.
 *   - `useInboxItemMetadata` always resolves to `[]`, so the per-file FITS
 *     metadata popover and the FR-032 missing-path-attribute gate can never
 *     populate/trigger via this seam.
 * This is a real, fixable gap (add the missing mock cases) — but doing so is
 * a product-code change, out of scope for this additive-test-only batch. Two
 * scenarios are `test.skip`-documented below rather than faked.
 */
import { test, expect } from "@playwright/test";

function seedSetupComplete(page: import("@playwright/test").Page): void {
	page.addInitScript(() => {
		window.localStorage.setItem(
			"alm-preferences",
			JSON.stringify({ setupCompleted: true }),
		);
	});
}

/**
 * spec 010's guided first-run coach auto-activates whenever
 * `alm-preferences.setupCompleted` is true (any mount runs `activateGuidedFlow`
 * in mock mode, landing on step "inbox.confirm_first"). Its react-joyride
 * spotlight targets `[data-guide-anchor="inbox.confirm-row"]` — the SAME
 * attribute carried by BOTH the per-detection Confirm button and the top-bar
 * bulk-confirm button (InboxDetail.tsx / InboxPage.tsx). Joyride only
 * computes a cutout for the first DOM match, so the OTHER element sharing the
 * selector stays covered by the tour's (real, hit-testable) overlay backdrop —
 * `{ force: true }` alone isn't enough, since Playwright still dispatches the
 * click at the element's screen coordinates and the browser delivers it to
 * whatever is actually on top. Hide the joyride portal outright: it is
 * explicitly documented as non-modal (`blockTargetInteraction: false`,
 * GuidedOverlay.tsx) so this doesn't change the behavior under test, only
 * removes an unrelated onboarding overlay this suite isn't about.
 */
async function disableGuidedTourOverlay(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.addStyleTag({
		content: "#react-joyride-portal { display: none !important; }",
	});
}

test.describe("inbox ingest · classify / reclassify / confirm (spec 041)", () => {
	test("cross-root aggregate list renders with reconciled per-type stats (spec 039 SC-001 / spec 041 US6 FR-021)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);

		await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

		// ── Cross-root aggregate: items from both root-lights-001 (/astro/raw)
		//    and root-inbox-001 (/astro/inbox) appear in a single list (spec 039).
		await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 8_000 });
		await expect(page.getByTestId("inbox-item-item-001")).toBeVisible();
		await expect(page.getByTestId("inbox-item-item-002")).toBeVisible();
		await expect(page.getByTestId("inbox-item-item-master-dark")).toBeVisible();
		await expect(page.getByTestId("inbox-item-item-003")).toBeVisible();

		// ── No selection yet: the bottom detail dock is not mounted ───────────────
		await expect(page.locator(".alm-listpage__detail")).toHaveCount(0);

		// ── Richer inbox queue statistics (US6): 3 non-master folders (item-001/
		//    002/003) + 1 master (item-master-dark), broken down per frame type by
		//    `deriveInboxStats` (dark: 1 master, mixed: 3 folders — none of the
		//    fixture items set `groupFrameType`, so all three fall into the
		//    "mixed" bucket; the master alone carries `masterFrameType: "dark"`). ──
		const statusSummary = page.getByTestId("statusbar-inbox-summary");
		await expect(statusSummary).toContainText(/3 folders/i);
		await expect(statusSummary).toContainText(/1 master/i);

		const statsSummary = page.getByTestId("inbox-stats-summary");
		await expect(statsSummary.getByTestId("inbox-stats-type-dark")).toBeVisible();
		await expect(statsSummary.getByTestId("inbox-stats-type-mixed")).toBeVisible();
		await expect(statsSummary.getByTestId("inbox-stats-type-mixed")).toContainText("3");
	});

	test("grouping the list by source then format nests items under their originating root (US2 FR-009 multi-level grouping)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);
		await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 8_000 });

		// Slot 0: group by "Source" (basename of the item's root path — the
		// closest observable analog, in the current mock/UI surface, to spec 041
		// US13's source-group provenance: root-lights-001 → "raw",
		// root-inbox-001 → "inbox").
		await page
			.getByRole("combobox", { name: "Group by", exact: true })
			.selectOption("source");
		// Slot 1: then by "Format" (fits / xisf / video) — a second, independent
		// dimension so the nesting is genuinely two levels deep.
		await page
			.getByRole("combobox", { name: "Then group by (level 2)" })
			.selectOption("format");

		// Top-level groups: "raw" (item-001, item-002, item-master-dark) and
		// "inbox" (item-003).
		const rawGroup = page.getByTestId("inbox-group-source-raw");
		const inboxGroup = page.getByTestId("inbox-group-source-inbox");
		await expect(rawGroup).toBeVisible();
		await expect(inboxGroup).toBeVisible();

		// Nested format groups under "raw": fits (item-001, item-002) + xisf
		// (item-master-dark). Under "inbox": video (item-003).
		await expect(page.getByTestId("inbox-group-format-fits")).toBeVisible();
		await expect(page.getByTestId("inbox-group-format-xisf")).toBeVisible();
		await expect(page.getByTestId("inbox-group-format-video")).toBeVisible();

		// The persisted grouping is echoed as a hint at the foot of the list.
		await expect(page.getByTestId("inbox-grouping-hint")).toContainText(
			/Source.*Format/i,
		);
	});

	test("a mixed detection shows its composition, blocks Confirm, and its needs-review file can be bulk-reclassified (US2 FR-011 / US3 FR-014 / US11 / US12 gate)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);
		await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 8_000 });

		await page.getByTestId("inbox-item-item-001").click();
		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });

		// FR-011: explicit multi-type composition, not a bare "mixed" label.
		const mixedAlert = detail.getByTestId("inbox-mixed-alert");
		await expect(mixedAlert).toBeVisible();
		await expect(mixedAlert).toContainText("Mixed folder");
		await expect(detail).toContainText("16 light");
		await expect(detail).toContainText("2 dark");

		// Confirm is disabled for a mixed row (spec 041 FR-050 — the backend
		// "split" action was removed; only single_type rows are confirmable).
		await expect(detail.getByTestId("inbox-confirm-btn")).toBeDisabled();

		// US12 needs-review bucket: the item's one unclassified file is listed
		// with a select-all + per-file override control.
		await expect(detail.getByText("Needs review (1)")).toBeVisible();
		const selectAll = detail.getByTestId("reclassify-select-all");
		await expect(selectAll).toBeVisible();

		// US11/FR-014: multi-select bulk override — select the file, choose a
		// bulk frame-type correction, and apply it to the whole selection.
		await selectAll.check();
		await detail.getByTestId("bulk-frame-type").selectOption("light");
		const bulkApplyBtn = detail.getByTestId("bulk-apply-btn");
		await expect(bulkApplyBtn).toContainText("Apply to selected (1)");
		await bulkApplyBtn.click();

		// FR-015: no leaked/failed-apply error banner, and the selection clears
		// once the (mocked) reclassify succeeds — the bulk-apply affordance is
		// ready to be used again rather than stuck mid-selection.
		await expect(detail.locator(".alm-inbox-detail__banner-mt2")).toHaveCount(0);
		await expect(selectAll).not.toBeChecked({ timeout: 5_000 });
	});

	test("confirming a single-type detection from an unorganized source produces a reviewable-plan toast (US1 FR-001/FR-002, US4 move path)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);
		await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 8_000 });

		// item-002: state=pending_classification, classify() resolves to
		// single_type "dark" — Confirm becomes available once classification
		// lands (all fixture items are organizationState="unorganized", so this
		// exercises the move-plan path per FR-017/FR-019).
		await page.getByTestId("inbox-item-item-002").click();
		const detail = page.locator(".alm-listpage__detail");
		await expect(detail).toBeVisible({ timeout: 5_000 });
		await expect(detail).toContainText("dark", { timeout: 5_000 });

		const confirmBtn = detail.getByTestId("inbox-confirm-btn");
		await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
		await confirmBtn.click();

		// The mock `inbox_confirm` always returns `{ itemsTotal: 18, planState:
		// 'ready_for_review', ... }`, surfaced via a toast (FR-001: a reviewable
		// plan is produced, not an immediate move).
		await expect(
			page.getByText(/Plan created \(18 items\)\. Review below before applying\./i),
		).toBeVisible({ timeout: 5_000 });

		// No error toast/boundary fired alongside the success toast.
		await expect(page.getByText(/Confirm failed/i)).toHaveCount(0);
		await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

		// NOTE: this mock's `inbox_list` fixture is STATIC (does not transition
		// the confirmed item's `state` to `plan_open`, mirroring the same
		// documented limitation `lifecycle_transitions.spec.ts` already notes for
		// `projects.list`), and the plan-approval overlay is unreachable in mock
		// mode (see the file header) — so the post-confirm "item stays visible as
		// planned" (SC-003) and "review the plan in-context" (SC-002) assertions
		// are NOT made here; they need the real backend / additional mocks.
	});

	test("bulk 'Confirm all classified' confirms every eligible detection in one action (US6 bulk affordance)", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/inbox");
		await disableGuidedTourOverlay(page);
		await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 8_000 });

		// Only item-001 carries state="classified" in the fixture, so the bulk
		// button targets exactly one item.
		const bulkBtn = page.getByTestId("inbox-bulk-confirm-btn");
		await expect(bulkBtn).toBeVisible();
		await expect(bulkBtn).toContainText("Confirm all (1)");
		await bulkBtn.click();

		await expect(
			page.getByText(/1 item confirmed — review plans below\./i),
		).toBeVisible({ timeout: 5_000 });
	});

	// ── Documented mock-layer gaps (see file header) — NOT faked ────────────────

	test.skip(
		"plan-approval overlay: review → apply/cancel a generated plan (US1 FR-003/FR-003a/FR-006/FR-007) — requires inbox_plan_list_open/inbox_plan_apply(_all|_selected)/inbox_plan_cancel mock cases that do not exist yet",
		async () => {
			// Intentionally skipped: `useOpenInboxPlans` calls `inbox_plan_list_open`,
			// which has no case in `mockInvoke` (apps/desktop/src/api/mocks.ts) and
			// throws "Unknown mock command"; the rejection is swallowed into hook
			// error state, so `openPlans` is always `[]` and the top-bar
			// "Review plans" trigger never renders in mock mode. Exercising the
			// PlanApprovalOverlay/PlanPanel apply/cancel/staleness flow needs either
			// the real backend (Layer-2/tauri-driver) or new mock cases — adding
			// those mocks is a product-code change outside this additive-tests-only
			// batch.
		},
	);

	test.skip(
		"catalogue-in-place confirm is distinguishable from a move plan (US4 FR-017/FR-018/SC-007) — requires an organizationState:'organized' fixture item and an inbox_confirm mock that branches on it",
		async () => {
			// Intentionally skipped: every item in the `inbox_list` mock fixture is
			// `organizationState: "unorganized"`, and the `inbox_confirm` mock
			// returns the exact same static response `{ planId, planState:
			// 'ready_for_review', itemsTotal: 18, registeredAsMaster: false }`
			// regardless of the confirmed item or its source's organization state.
			// There is currently no way, at the mock e2e layer, to observe "zero
			// file movements + a catalogue record" (FR-018) as distinct from the
			// move-plan path asserted above — both render an identical toast. This
			// needs either the real backend or a smarter mock (an "organized" fixture
			// item + branching inbox_confirm logic), which is a product-code change
			// outside this additive-tests-only batch.
		},
	);
});
