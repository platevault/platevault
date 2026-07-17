// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → Framing pane — clustering tolerance tunables (mock-mode
 * Playwright, spec 008 Q27 F-Framing-9/F-Framing-11).
 *
 * This is the ONLY real UI surface the spec 008 Q27 framing/attribution
 * feature has today. The framing grouping list/merge/split/reassign use
 * cases (`projects.framing.*`) and the Inbox-confirm attribution pass
 * (`inbox.confirm`'s `attributionCandidates`/`chosenAttribution`) are real,
 * shipped backend commands with NO frontend consumer yet — see
 * `docs/development/windows-journeys/journey-11-framing-clustering-
 * attribution.md` for that backend-only-IPC scenario and the corresponding
 * Layer-1 test coverage (`crates/app/inbox/src/attribution.rs`,
 * `crates/app/core/src/framing.rs`, `crates/sessions/src/clustering.rs`,
 * `crates/app/core/tests/attribution_integration.rs`). Nothing about the
 * grouping/attribution FLOW itself is reachable from this mock-Playwright
 * layer, structurally, until a consuming UI exists.
 *
 * Mock-mode round-trip: `settings_get('framing')` / `settings_update('framing',
 * …)` mutate the module-level `mockFramingSettings` fixture
 * (`apps/desktop/src/api/mocks.ts`), seeded at the R11a shipped defaults —
 * mirrors the Ingestion/Cleanup panes' proven round-trip pattern.
 */
import { expect, seedSetupComplete, test } from "./support/harness";

test.describe("Settings · Framing clustering tolerances (spec 008 Q27 F-Framing-11)", () => {
	test("pane loads R11a defaults, edits the pointing tolerance, and PERSISTS via the settings mock round-trip", async ({
		page,
	}) => {
		seedSetupComplete(page);
		await page.goto("/#/settings/framing");

		// Pane loaded: section title + the four R11a-default values.
		await expect(
			page.getByText("Clustering Tolerances", { exact: true }),
		).toBeVisible();
		// `getByTestId`, not `getByLabel`: the row's InfoTip tooltip text
		// contains "pointing tolerance" as a substring, so a substring-matching
		// accessible-name locator resolves ambiguously to both the input and
		// the tooltip note.
		const pointingFraction = page.getByTestId(
			"framing-pointing-fraction-input",
		);
		const pointingFallback = page.getByTestId(
			"framing-pointing-fallback-input",
		);
		const rotation = page.getByTestId("framing-rotation-tolerance-input");
		const mosaicEnvelope = page.getByTestId("framing-mosaic-envelope-input");
		await expect(pointingFraction).toHaveValue("0.1");
		await expect(pointingFallback).toHaveValue("0.2");
		await expect(rotation).toHaveValue("3");
		await expect(mosaicEnvelope).toHaveValue("1");

		// Edit → auto-save on blur (no global Save button, matching every other
		// settings pane's convention). Fires `settings_update('framing', …)`,
		// which mutates the mock fixture.
		await pointingFraction.fill("0.25");
		await pointingFraction.blur();
		await expect(pointingFraction).toHaveValue("0.25");

		// `save()` debounces via useAutoSave (300ms) before it actually calls
		// `settings_update`; wait it out so the mock has genuinely persisted the
		// edit before navigating away (otherwise this proves nothing about
		// backend persistence — just lingering component state; same convention
		// as the Cleanup pane's round-trip proof).
		await page.waitForTimeout(400);

		// Round-trip proof: leave the pane (Framing unmounts) and return (it
		// re-mounts and re-fetches via `settings_get('framing')`). The value must
		// survive because the mock persisted it, not because component state
		// lingered — mirrors the Ingestion/Cleanup pane proofs.
		await page.getByRole("button", { name: "Appearance", exact: true }).click();
		await expect(page.getByText("Theme", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Framing", exact: true }).click();

		const pointingFractionAfter = page.getByTestId(
			"framing-pointing-fraction-input",
		);
		await expect(pointingFractionAfter).toBeVisible();
		await expect(pointingFractionAfter).toHaveValue("0.25");
		// Untouched fields keep their R11a defaults across the round-trip too.
		await expect(
			page.getByTestId("framing-rotation-tolerance-input"),
		).toHaveValue("3");
	});
});
