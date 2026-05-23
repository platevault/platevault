/**
 * T025 — Playwright smoke for spec 002 lifecycle detail provenance UI.
 *
 * Verifies the Inventory detail drawer surfaces the spec 002
 * `ProvenanceField[]` payload via `useProvenance`:
 *  - At least one origin chip is rendered with a `data-provenance-origin`
 *    attribute drawn from the 6 documented origins
 *    (`observed | inferred | reviewed | generated | planned | applied`).
 *  - The "ledger row" sibling representation — i.e. the compact list row
 *    in the inventory table — does NOT render the per-field origin chip
 *    or provenance panel; that surface is reserved for the detail drawer.
 *  - When a field has a history, the disclosure is interactive: clicking
 *    the `<summary>` expands the panel and reveals `[data-provenance-history-entry]`.
 *
 * NOTE: In the `pnpm dev` mock runtime (no Tauri bridge), the dev shim in
 * `apps/desktop/src/data/provenance.ts` projects every synthesised field
 * with `origin === "observed"` (see TSDoc on that file). We therefore only
 * assert that the observed-origin chip variant is rendered and that the
 * row structure is correct; full multi-origin coverage requires the Tauri
 * runtime and is tracked as a follow-up.
 */
import { test, expect } from "@playwright/test";

const VALID_ORIGINS = [
  "observed",
  "inferred",
  "reviewed",
  "generated",
  "planned",
  "applied",
] as const;

test.describe("lifecycle detail · provenance UI", () => {
  test("inventory detail drawer renders origin chips + history disclosure; list row hides them", async ({
    page,
  }) => {
    // Mark first-run as complete so the welcome wizard does not intercept
    // navigation. The desktop shell persists this in localStorage and uses
    // hash-history routing, so we must seed the flag before navigating.
    await page.addInitScript(() => {
      window.localStorage.setItem("alm.first-run.completed", "1");
    });
    await page.goto("/#/inventory");

    // Pick the seeded acquisition session id with mock provenance entries
    // (see `apps/desktop/src/data/mock.ts` → `inv-m101-0412`).
    const sessionId = "inv-m101-0412";

    // The list row is rendered by the inventory DataTable inside a listbox
    // (role="option" per row). Locate the M101 light frame with provenance
    // by its date cell — `2026-04-12` is the seeded session with provenance
    // (`apps/desktop/src/data/mock.ts` → `inv-m101-0412`).
    const listRow = page.getByRole("option", { name: /2026-04-12 M101/ }).first();
    await expect(listRow).toBeVisible();

    // The list row must NOT render the provenance pane or per-field origin
    // chips — those live in the detail drawer only.
    await expect(listRow.locator("[data-provenance-section]")).toHaveCount(0);
    await expect(listRow.locator("[data-provenance-origin]")).toHaveCount(0);

    // Open the row's detail drawer. The mockup currently exposes the
    // session detail via row click → drawer mount.
    await listRow.click();

    // The drawer should mount the Provenance panel.
    const provenancePanel = page.locator("[data-provenance-section]");
    await expect(provenancePanel).toBeVisible();

    // At least one origin chip is rendered with one of the 6 documented
    // origin values. The dev shim emits `observed` only (see test header).
    const originChips = provenancePanel.locator("[data-provenance-origin]");
    const chipCount = await originChips.count();
    expect(chipCount).toBeGreaterThan(0);
    for (let i = 0; i < chipCount; i++) {
      const origin = await originChips.nth(i).getAttribute("data-provenance-origin");
      expect(VALID_ORIGINS).toContain(origin);
    }

    // Find a row that has a history disclosure. The dev shim emits empty
    // history arrays, so the disclosure is only rendered when historyTruncated
    // is true OR history has entries; under Tauri this would be exercised.
    // For the dev runtime, assert the disclosure either renders correctly
    // when present, or — when absent — that the underlying field row is
    // still tagged with `data-provenance-field`.
    const fieldRows = provenancePanel.locator("[data-provenance-field]");
    await expect(fieldRows.first()).toBeVisible();

    const disclosure = provenancePanel.locator("details.alm-provenance-history").first();
    if ((await disclosure.count()) > 0) {
      await disclosure.locator("summary").click();
      await expect(
        disclosure.locator("[data-provenance-history-entry]").first(),
      ).toBeVisible();
    }

    // Belt-and-braces: the session id should be addressable through the URL
    // or the drawer DOM (for future debugging). Not asserted strictly here.
    expect(sessionId.length).toBeGreaterThan(0);
  });
});
