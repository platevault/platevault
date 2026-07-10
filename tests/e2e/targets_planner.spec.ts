/**
 * Playwright mock-e2e: Targets & planning (Journey 9 of the E2E revalidation,
 * Phase B / Batch 5). This journey previously had ZERO Playwright coverage
 * (see `docs/development/e2e-mock-coverage-audit-2026-07-05.md`, Batch 5).
 *
 * Specs exercised:
 *   - 035 (SIMBAD target resolution): resolve-on-demand long-tail + seed catalog.
 *   - 023 (target identity/history): identity + aliases surfaced in search rows.
 *   - 044 (targets planner astronomy, Track A/B): per-site max altitude tonight +
 *     imaging-time; observing-site model + gate.
 *   - 047 (targets planner moon/filters): moon phase / illumination, per-target
 *     lunar separation, moon-driven filter guidance, opposition; the site gate
 *     (D7) that renders NO astronomy until a default observing site exists.
 *
 * ── The #450 planner-dead-gate regression this file pins ─────────────────────
 *
 * `features/targets/site-gate.ts` gates ALL planner astronomy behind
 * `activeSite() !== null` (spec 047 D7). If that gate can never open — the #450
 * "planner dead-gate" bug — the planner silently shows nothing forever even
 * after a site is configured. The `PLANNER REGRESSION GUARD` describe below
 * pins BOTH sides of the gate so it can never silently die again:
 *   - no observing site  → the explicit "set up your observing site" prompt
 *     (NOT a crash, NOT a silently-blank planner), and every astronomy value is
 *     the honest "—" placeholder / degraded 0° (never a fabricated number);
 *   - active observing site → the Moon summary (047) AND real per-site
 *     altitude/imaging-time (044) + lunar separation / opposition (047) values
 *     appear.
 *
 * ── How the observing site is seeded (mock layer) ────────────────────────────
 *
 * The site store (`observing-sites/site-store.ts`) hydrates the gate from
 * `settings_get('observing')` (see `Shell.tsx` → `loadObservingState()`), and
 * the usable-altitude threshold reads the same scope. The enriched mock
 * (`apps/desktop/src/api/mocks.ts`) makes the `observing` scope reflect a
 * per-session values bag seeded from the `alm-e2e-observing` localStorage key.
 * `seedObservingSite()` below sets that key BEFORE navigation, so the mock's
 * `settings_get('observing')` returns a real active site and the gate opens —
 * exactly as the real backend would after a Settings → Observing Sites save.
 * With the key absent the scope resolves to empty values → no active site →
 * gate stays closed.
 *
 * This batch is ADDITIVE: the only product-adjacent change is the scope-aware
 * `settings_get`/`settings_update` for the `observing` scope in `mocks.ts`
 * (faithful to the real per-scope settings transport); no app behaviour changed.
 */
import {
  test,
  expect,
  seedSetupComplete,
  disableGuidedTourOverlay,
} from "./support/harness";
import type { Page } from "@playwright/test";

/**
 * Seed an active observing site into the mock `observing` settings scope so the
 * planner gate (`activeSite() !== null`) opens. Amsterdam (lat +52) keeps the
 * northern deep-sky seed targets (M 31 dec +41, NGC 7000 dec +44) high in the
 * sky, so max-altitude tonight is a large, date-stable culmination value.
 */
function seedObservingSite(page: Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem(
      "alm-e2e-observing",
      JSON.stringify({
        observingSites: [
          {
            id: "site-e2e-1",
            name: "Backyard (Amsterdam)",
            latitudeDeg: 52.37,
            longitudeDeg: 4.9,
            elevationM: 5,
            timezone: "Europe/Amsterdam",
            twilight: "astronomical",
            minHorizonAltDeg: 0,
          },
        ],
        observingActiveSiteId: "site-e2e-1",
        observingDefaultSiteId: "site-e2e-1",
        usableAltitudeDeg: 30,
      }),
    );
  });
}

/** Locate a target row by its designation text (only 2 seed rows exist). */
function targetRow(page: Page, designation: string) {
  return page.locator(".alm-targets-table__row", { hasText: designation });
}

// Column order in TargetsTable (see COLUMNS): 0 star · 1 designation · 2 type ·
// 3 maxAlt · 4 spark · 5 visible · 6 opposition · 7 lunarDist · 8 filters ·
// 9 imagingTime · 10 sessions.
const COL = {
  maxAlt: 3,
  opposition: 6,
  lunarDist: 7,
  imagingTime: 9,
  sessions: 10,
} as const;

test.describe("PLANNER REGRESSION GUARD · site gate (spec 047 D7, #450)", () => {
  /**
   * NO observing site → the planner is honestly GATED, not silently dead:
   *   - the "set up your observing site" prompt renders in the top bar;
   *   - the Moon summary (047) does NOT render;
   *   - the "add a site" info banner renders above the table;
   *   - every per-target astronomy value degrades to the honest placeholder
   *     ("—" for lunar/opposition, 0° max altitude) — never a fabricated number.
   */
  test("9.1a · with NO observing site the planner shows the set-up prompt and no astronomy", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // The site-gate prompt is shown; the Moon summary is NOT.
    const prompt = page.getByTestId("planner-site-prompt");
    await expect(prompt).toBeVisible({ timeout: 8_000 });
    await expect(prompt).toContainText("Set up your observing site");
    await expect(prompt).toContainText(
      "Add a default observing location so the planner can compute",
    );
    await expect(page.getByTestId("moon-summary")).toHaveCount(0);

    // The table-level "add a site" info banner is shown.
    await expect(page.locator(".alm-targets-table__no-site-banner")).toBeVisible();

    // The seed catalog still lists targets (list is independent of the gate)…
    const m31 = targetRow(page, "M 31");
    await expect(m31).toBeVisible();

    // …but every astronomy value is the honest placeholder, never fabricated:
    //   - lunar / opposition cells render "—" (no `.alm-targets-cell--lunardist`
    //     span is emitted when the value is unknown);
    //   - max altitude degrades to 0°.
    await expect(page.locator(".alm-targets-cell--lunardist")).toHaveCount(0);
    await expect(m31.locator("td").nth(COL.opposition)).toHaveText("—");
    await expect(m31.locator("td").nth(COL.maxAlt)).toHaveText("0°");
  });

  /**
   * Active observing site → the gate OPENS and the full planner renders:
   *   - the Moon summary (047 Track A: phase name + illumination + direction);
   *   - real per-site max altitude tonight + imaging time (044);
   *   - real per-target lunar separation (047 US2) and opposition (047 US4);
   *   - the "add a site" banner and set-up prompt are gone.
   * This is the direct pin against the #450 dead-gate: once a site exists the
   * planner MUST come alive with real computed values.
   */
  test("9.1b · seeding an active observing site brings the planner alive with real 044+047 values", async ({
    page,
  }) => {
    seedSetupComplete(page);
    seedObservingSite(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    await expect(page.getByTestId("app-error-boundary-fallback")).not.toBeVisible();

    // ── 047 Track A: the Moon summary renders with real computed values ───────
    const moon = page.getByTestId("moon-summary");
    await expect(moon).toBeVisible({ timeout: 8_000 });
    await expect(moon).toContainText("Moon tonight");
    // Real astronomy-engine output: an 8-phase name…
    await expect(moon.locator(".alm-moon-summary__phase")).toHaveText(
      /new moon|crescent|quarter|gibbous|full moon/i,
    );
    // …and an illumination % + waxing/waning direction (FR-002/FR-003).
    await expect(moon.locator(".alm-moon-summary__meta")).toHaveText(
      /\d{1,3}% illuminated · (waxing|waning)/,
    );
    // The full text equivalent is exposed via aria-label (accessibility).
    await expect(moon).toHaveAttribute(
      "aria-label",
      /^Moon tonight: .+, \d{1,3} percent illuminated, (waxing|waning)\.$/,
    );

    // The gated-off prompt + banner are gone now a site exists.
    await expect(page.getByTestId("planner-site-prompt")).toHaveCount(0);
    await expect(page.locator(".alm-targets-table__no-site-banner")).toHaveCount(0);

    // ── 044: real per-site altitude — M 31 (dec +41) culminates high from a
    //    +52° site, so max altitude tonight is a large non-zero value (was 0°
    //    with no site). Date-stable (culmination ≈ 90 − |lat − dec| ≈ 79°). ────
    const m31 = targetRow(page, "M 31");
    await expect(m31).toBeVisible();
    const maxAlt = m31.locator("td").nth(COL.maxAlt);
    await expect(maxAlt).toHaveText(/°$/);
    await expect(maxAlt).not.toHaveText("0°");

    // ── 047 US2: real target↔Moon angular separation (geometry, always known
    //    for a coordinate-bearing target) renders as a degree value, not "—". ──
    const lunar = m31.locator("td").nth(COL.lunarDist);
    await expect(lunar).toHaveText(/\d{1,3}°/);
    await expect(lunar.locator(".alm-targets-cell--lunardist")).toBeVisible();

    // ── 047 US4: real next-opposition date + relative "in N days/months". ─────
    const opposition = m31.locator("td").nth(COL.opposition);
    await expect(opposition).toContainText(/in \d+ (day|days|month|months)/);
    await expect(opposition).not.toHaveText("—");

    // ── 047 US3: moon-driven filter guidance pills render in the Filters cell. ─
    await expect(m31.locator(".alm-guidance-cell__trigger")).toBeVisible();

    // ── 044: imaging-time column present; renders an honest value ("N h" when
    //    the target clears the threshold tonight, else "—") — never fabricated. ─
    await expect(page.getByRole("columnheader", { name: "Img time" })).toBeVisible();
    await expect(m31.locator("td").nth(COL.imagingTime)).toHaveText(/^(\d+(\.\d+)? h|—)$/);
  });

  /**
   * The gate is DYNAMIC (spec 047: the planner opens "the moment a site is
   * created … without a reload"). Persisting a site through
   * `settings_update('observing')` and reloading the same context must flip the
   * planner on — proving the round-trip the real Settings → Observing Sites save
   * performs, and that the gate is not wedged shut (the essence of #450).
   */
  test("9.1c · a persisted observing site opens the planner after reload (dynamic gate)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);
    // Gate closed initially.
    await expect(page.getByTestId("planner-site-prompt")).toBeVisible({ timeout: 8_000 });

    // Persist a site through the same IPC the Settings pane uses; the mock's
    // observing scope round-trips it (settings_update → settings_get).
    await page.evaluate(() => {
      const site = {
        id: "site-persist-1",
        name: "Persisted site",
        latitudeDeg: 48.1,
        longitudeDeg: 11.6,
        elevationM: 520,
        timezone: "Europe/Berlin",
        twilight: "astronomical",
        minHorizonAltDeg: 0,
      };
      window.localStorage.setItem(
        "alm-e2e-observing",
        JSON.stringify({
          observingSites: [site],
          observingActiveSiteId: site.id,
          observingDefaultSiteId: site.id,
          usableAltitudeDeg: 30,
        }),
      );
    });
    await page.reload();
    await disableGuidedTourOverlay(page);

    // Planner alive after reload.
    await expect(page.getByTestId("moon-summary")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("planner-site-prompt")).toHaveCount(0);
  });
});

test.describe("Planner date picker + per-band moon-free hours (spec 044 Track B US2/US5)", () => {
  /**
   * T024 (FR-008/SC-004): choosing a different planning date recomputes the
   * table's observability for that night. M 31's transit altitude is
   * date-independent (culmination only depends on lat/dec), so this asserts
   * against the date-DEPENDENT "Img time" figure instead: jumping the date
   * forward by ~half a year moves to the opposite season, which changes the
   * dark-window/imaging-time figure for essentially any real test-run date
   * (the only false-negative window is exactly at an equinox-like coincidence,
   * vanishingly unlikely). Resetting via "Tonight" must restore the original
   * value exactly, proving the round-trip (not just "some value changed").
   */
  test("9.4a · choosing a future date changes Img time, and Tonight restores it", async ({
    page,
  }) => {
    seedSetupComplete(page);
    seedObservingSite(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    const m31 = targetRow(page, "M 31");
    await expect(m31).toBeVisible({ timeout: 8_000 });
    const imgTimeCell = m31.locator("td").nth(COL.imagingTime);
    const beforeText = await imgTimeCell.textContent();

    const dateInput = page.getByLabel("Plan for");
    await expect(dateInput).toBeVisible();
    const today = new Date();
    const future = new Date(today.getTime() + 182 * 86_400_000);
    const futureValue = future.toISOString().slice(0, 10);
    await dateInput.fill(futureValue);

    const resetBtn = page.getByRole("button", { name: "Tonight" });
    await expect(resetBtn).toBeVisible();
    await expect(imgTimeCell).not.toHaveText(beforeText ?? "");

    await resetBtn.click();
    await expect(resetBtn).toHaveCount(0);
    await expect(imgTimeCell).toHaveText(beforeText ?? "");
  });

  /**
   * T029 (FR-007/FR-022): the Filters guidance popover shows each band's real
   * moon-free imaging hours alongside Track A's required-separation figure.
   */
  test("9.4b · the Filters guidance popover shows per-band moon-free hours", async ({
    page,
  }) => {
    seedSetupComplete(page);
    seedObservingSite(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    const m31 = targetRow(page, "M 31");
    await expect(m31).toBeVisible({ timeout: 8_000 });
    await m31.locator(".alm-guidance-cell__trigger").click();

    const popup = page.getByTestId("guidance-explain-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(/h moon-free/);
  });
});

test.describe("Target catalog + SIMBAD resolve-on-demand (spec 035 / 023)", () => {
  /**
   * The Targets page lists the seed catalog (spec 035 US1 local seed). Both
   * northern seed objects appear in the list from the `target_list` mock.
   */
  test("9.2a · the target catalog list renders seed objects", async ({ page }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    await expect(targetRow(page, "M 31")).toBeVisible({ timeout: 8_000 });
    await expect(targetRow(page, "NGC 7000")).toBeVisible();
  });

  /**
   * SIMBAD resolve-on-demand (spec 035 US3, FR long-tail): a query with a local
   * seed hit shows that hit with its identity/aliases (spec 023) — the primary
   * designation, the common-name secondary line, and the `seed` source badge.
   */
  test("9.2b · a seed hit surfaces identity + aliases in the search typeahead", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    await page.getByRole("button", { name: "Add target" }).click();
    const search = page.getByLabel("Search for a target");
    await expect(search).toBeVisible();
    await search.fill("M 31");

    const option = page.locator(".alm-target-search__option", { hasText: "M 31" });
    await expect(option).toBeVisible({ timeout: 8_000 });
    // Identity + alias (spec 023): common name secondary + object-type + source.
    await expect(option).toContainText("Andromeda Galaxy");
    await expect(option).toContainText("seed");
  });

  /**
   * SIMBAD long-tail (spec 035 US3): a query with NO local seed hit is resolved
   * ON DEMAND via `target.resolve` and merged into the list with the `resolved`
   * source badge — the resolve-on-demand path that only a live resolver call
   * produces. The mock's `target_resolve` mirrors the real "resolved" envelope.
   */
  test("9.2c · a long-tail query resolves on demand via SIMBAD (resolved source)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    await page.getByRole("button", { name: "Add target" }).click();
    const search = page.getByLabel("Search for a target");
    await expect(search).toBeVisible();
    // "IC 1805" is not in the seed; only the long-tail resolver can supply it.
    await search.fill("IC 1805");

    const option = page.locator(".alm-target-search__option", { hasText: "IC 1805" });
    await expect(option).toBeVisible({ timeout: 8_000 });
    await expect(option).toContainText("resolved");
  });
});

test.describe("Honest empty-state disclosure (no fabricated data)", () => {
  /**
   * Not-yet-built data must be disclosed honestly, never fabricated:
   *   - the Sessions column (backend linkage #57 not landed) is ALWAYS "—",
   *     never a made-up linked-session count — even with an active site;
   *   - the favourite star column shows every row un-starred (#54 client-side
   *     favourites, no fabricated favourites) with aria-pressed=false.
   */
  test("9.3a · sessions count and favourites are honestly empty, not fabricated", async ({
    page,
  }) => {
    seedSetupComplete(page);
    seedObservingSite(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    const m31 = targetRow(page, "M 31");
    await expect(m31).toBeVisible({ timeout: 8_000 });

    // Sessions column: always the honest "—" (linked-session count not on the
    // list payload yet — #57), never a fabricated number.
    await expect(m31.locator("td").nth(COL.sessions)).toHaveText("—");
    await expect(targetRow(page, "NGC 7000").locator("td").nth(COL.sessions)).toHaveText("—");

    // Favourites (#54): every star is un-filled and reports aria-pressed=false —
    // no fabricated "starred" state.
    const star = m31.locator(".alm-targets-star");
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await expect(star).toContainText("☆");
  });

  /**
   * The "My Targets" filter is backed by a client-side favourites stub (#54,
   * backend linkage not landed). With no favourites it must show the honest
   * empty state, NOT fabricate a "my targets" list.
   */
  test("9.3b · My Targets with no favourites shows the honest empty state", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/targets");
    await disableGuidedTourOverlay(page);

    // Baseline: the catalog is populated.
    await expect(targetRow(page, "M 31")).toBeVisible({ timeout: 8_000 });

    // Switch the "Show" filter to "My Targets" (native <select>, aria-label "Show").
    await page.getByLabel("Show").selectOption("my");

    // Honest empty state — not a fabricated list.
    await expect(
      page.getByText("No favourites yet. Star a target (☆) to add it here."),
    ).toBeVisible();
    await expect(targetRow(page, "M 31")).toHaveCount(0);
  });
});
