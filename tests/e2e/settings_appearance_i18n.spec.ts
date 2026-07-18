// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Journey 10 — Settings config model, appearance/themes, layout convention,
 * i18n, and the bottom log viewer (mock-mode Playwright).
 *
 * Specs covered:
 *   - 018 (settings configuration model): auto-save round-trip, one-setting-
 *     per-line panes, cleanup per-type action overrides.  FR-002/FR-004/FR-006.
 *   - 043 (UI redesign / PlateVault): 4-theme + System appearance system with
 *     `data-theme` on <html>, persisted in `localStorage['alm.theme']`; the
 *     page-layout convention (`.alm-page__bar` pinned, content scroll region
 *     `overflow-y:auto` — action bar always visible, only content scrolls).
 *   - 046 (i18n / error-codes): Paraglide baseLocale catalog. FR-004 hard-pins
 *     English with NO in-app language switcher, so this suite asserts the
 *     HONEST single-locale state — every `settings_*` key resolves to a human
 *     string (no raw-key fallback leaks) and a plural-bearing message renders
 *     the correct plural form — rather than exercising a locale toggle that,
 *     by design (FR-004), does not exist in the UI.
 *   - 019 (bottom log viewer): full-width fold-out log panel, level filter
 *     chips, follow-tail + export controls, Escape-to-close. FR-001/003/007.
 *
 * All assertions run against the mock IPC layer (`VITE_USE_MOCKS=true`, pinned
 * by playwright.config.ts). Settings persistence is exercised through the
 * arg-sensitive settings mocks: `ingestion_settings_update` mutates the
 * module-level `mockIngestionSettings` fixture that `ingestion_settings_get`
 * re-reads (spec 030 P12), and the Cleanup per-type table round-trips through
 * `localStorage['alm.cleanup.type_actions.v2']`.
 *
 * Mock-mode honesty notes (Layer-2-only flows, NOT asserted here):
 *   - The log panel's truncation marker (`logpanel_history_gap*`) is not
 *     reachable in mock mode: `startLogSubscription` seeds MOCK_LOG_ENTRIES
 *     directly and never marks the buffer truncated (only a real backend
 *     `log_recent` with `truncated:true` triggers it). This file asserts the
 *     marker is ABSENT and exercises the reachable controls instead.
 *   - Locale switching is not user-reachable (046 FR-004); no product switcher
 *     exists to drive.
 */
import { test, expect, seedSetupComplete } from "./support/harness";
import type { Page } from "@playwright/test";

// ── Scenario 1 — Settings config model persists (spec 018) ──────────────────

test.describe("Journey 10 · Settings configuration model (spec 018)", () => {
  test("Ingestion pane loads current values, edits, and PERSISTS via the settings mock round-trip", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/ingestion");

    // Pane loaded: section title + a representative one-setting-per-line row
    // (FR-002). Settings section titles are styled <div>s, not heading roles.
    await expect(page.getByText("Scan defaults", { exact: true })).toBeVisible();
    const hashing = page.getByLabel("Hashing mode");
    // Current (seeded) value from mockIngestionSettings.
    await expect(hashing).toHaveValue("lazy");

    // Edit → auto-save (FR-004: no global Save button). Selecting the option
    // fires `ingestion_settings_update`, which mutates the mock fixture.
    await hashing.selectOption("eager");
    await expect(hashing).toHaveValue("eager");

    // Round-trip proof: leave the pane (Ingestion unmounts) and return
    // (it re-mounts and re-fetches via `ingestion_settings_get`). The value
    // must survive because the mock persisted it, not because component state
    // lingered.
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ingestion", exact: true }).click();

    const hashingAfter = page.getByLabel("Hashing mode");
    await expect(hashingAfter).toBeVisible();
    await expect(hashingAfter).toHaveValue("eager");
  });

  test("Cleanup pane renders the per-type override table and persists an override via the settings mock round-trip", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/cleanup");

    // Per-type action table present (spec 018 cleanup override surface).
    await expect(
      page.getByText("Per-Type Default Actions", { exact: true }),
    ).toBeVisible();

    // "Raw dark frames" defaults to "Archive"; flip it to "Keep" (a non-default
    // choice, so the override is observable). This now fires
    // `settings_update('cleanup', { cleanupTypeOverrides })` (spec 051 US3),
    // not a localStorage write.
    const row = page.getByRole("row").filter({ hasText: "Raw dark frames" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Archive" })).toHaveClass(
      /alm-seg__btn--active/,
    );
    // Cleanup's mount effect fires `settings_get('cleanup')` (mock IPC has a
    // randomized 50-150ms artificial latency, see `apps/desktop/src/api/mocks.ts`
    // `mockInvoke`'s `delay(50 + random*100)`). That in-flight fetch used to be
    // able to resolve AFTER this click and clobber the just-set local state
    // back to "Archive"; Cleanup.tsx now tracks whether an edit happened and
    // ignores a mount fetch that resolves afterwards, so a single click+assert
    // is sufficient (no retry needed).
    await row.getByRole("button", { name: "Keep" }).click();
    await expect(row.getByRole("button", { name: "Keep" })).toHaveClass(
      /alm-seg__btn--active/,
      { timeout: 15_000 },
    );

    // `save()` debounces via useAutoSave (300ms) before it actually calls
    // `settings_update`; wait it out so the mock has genuinely persisted the
    // override before we navigate away (otherwise this proves nothing about
    // backend persistence — just lingering component state).
    await page.waitForTimeout(400);

    // Round-trip proof: leave the pane (Cleanup unmounts) and return (it
    // re-mounts and re-fetches via `settings_get('cleanup')`). The value must
    // survive because the mock persisted it, not because component state
    // lingered — mirrors the Ingestion pane proof above.
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cleanup", exact: true }).click();

    const rowAfter = page.getByRole("row").filter({ hasText: "Raw dark frames" });
    await expect(rowAfter).toBeVisible();
    // No stomp risk here (single settings_get after remount, no competing
    // local click) — just the same mock IPC latency, so a longer read-only
    // wait is sufficient.
    await expect(rowAfter.getByRole("button", { name: "Keep" })).toHaveClass(
      /alm-seg__btn--active/,
      { timeout: 15_000 },
    );
  });
});

// ── Scenario 2 — Appearance / 4 themes (spec 043) ───────────────────────────

const THEME_CASES: { name: string; dataTheme: string }[] = [
  { name: "Warm Clay", dataTheme: "warm-clay" },
  { name: "Warm Slate", dataTheme: "warm-slate" },
  { name: "Observatory", dataTheme: "observatory-dark" },
  { name: "Espresso", dataTheme: "espresso-dark" },
];

test.describe("Journey 10 · Appearance / 4 themes (spec 043)", () => {
  test("switching among the 4 themes updates data-theme on <html> and persists", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/general");
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();

    // System + 4 named themes = 5 swatch cards.
    const swatches = page.locator(".alm-theme-swatch");
    await expect(swatches).toHaveCount(5);

    for (const theme of THEME_CASES) {
      // Swatch buttons' accessible name is "<Theme name> <mode>" (e.g. "Warm
      // Clay Light"); match by the brand-name substring (not exact).
      await page.getByRole("button", { name: theme.name }).click();
      // The appearance runtime writes data-theme on the document root.
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme.dataTheme,
      );
      // Choice is persisted in localStorage under `alm.theme`.
      const stored = await page.evaluate(() => localStorage.getItem("alm.theme"));
      expect(stored).toBe(theme.dataTheme);
    }
  });

  test("theme choice survives navigating away from Settings (#794)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/general");
    await page.getByRole("button", { name: "Warm Clay" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "warm-clay",
    );

    // #794 repro: switch theme, then navigate away — the choice must not
    // silently revert to the resolved-system dark default.
    await page.goto("/#/targets");
    await expect(page.locator(".alm-sidebar")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "warm-clay",
    );
  });

  test("theme choice survives a full reload (applied at boot via initAppearance)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/general");
    await page.getByRole("button", { name: "Espresso" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "espresso-dark",
    );

    await page.reload();
    // Boot-time initAppearance() re-applies the persisted theme before render.
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "espresso-dark",
    );
  });
});

// ── Scenario 3 — Layout convention (spec 043) ───────────────────────────────

test.describe("Journey 10 · Page-layout convention (spec 043)", () => {
  // The Settings Cleanup pane has a long per-type table, so its content region
  // (`.alm-two-pane__detail`, overflow-y:auto) actually overflows at 720px —
  // making it a faithful probe for "action bar always visible, only content
  // scrolls".
  async function assertBarPinnedWhileContentScrolls(
    page: Page,
    height: number,
  ): Promise<void> {
    await page.setViewportSize({ width: 1100, height });

    const bar = page.locator(".alm-page__bar").first();
    await expect(bar).toBeVisible();
    const barBoxBefore = await bar.boundingBox();
    expect(barBoxBefore).not.toBeNull();

    const scroller = page.locator(".alm-two-pane__detail").first();
    // Content must genuinely overflow, else "only content scrolls" is untested.
    const overflow = await scroller.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(overflow).toBeGreaterThan(0);

    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const scrolledTo = await scroller.evaluate((el) => el.scrollTop);
    expect(scrolledTo).toBeGreaterThan(0);

    // The pinned bar must NOT have moved and must still be visible after the
    // content region scrolled.
    await expect(bar).toBeVisible();
    const barBoxAfter = await bar.boundingBox();
    expect(barBoxAfter).not.toBeNull();
    expect(Math.round(barBoxAfter!.y)).toBe(Math.round(barBoxBefore!.y));
  }

  test("action bar stays pinned while only the content region scrolls (1100x720 and a shorter height)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/cleanup");
    await expect(
      page.getByText("Per-Type Default Actions", { exact: true }),
    ).toBeVisible();
    // The top action bar carries the page title.
    await expect(
      page.locator(".alm-page__bar").getByText("Settings", { exact: true }),
    ).toBeVisible();

    await assertBarPinnedWhileContentScrolls(page, 720);
    await assertBarPinnedWhileContentScrolls(page, 500);
  });
});

// ── Scenario 4 — i18n (spec 046) ────────────────────────────────────────────

test.describe("Journey 10 · i18n catalog (spec 046)", () => {
  test("Settings renders human strings — no raw message-key fallbacks leak", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/sources");

    // Known keys must resolve to their English strings, not literal keys.
    await expect(
      page.locator(".alm-page__bar").getByText("Settings", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Data Sources", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Appearance", exact: true }),
    ).toBeVisible();

    // No `settings_*` / `logpanel_*` / `common_*` raw Paraglide key may appear
    // as literal visible text anywhere on the page (raw-key leak guard).
    const rawKeyLeak = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(
        /\b(settings|logpanel|common|inbox|sessions|targets)_[a-z0-9_]{3,}\b/,
      );
      return m ? m[0] : null;
    });
    expect(rawKeyLeak).toBeNull();

    // Every settings-nav label must be a rendered string, never a raw key.
    const navLabels = await page
      .locator(".alm-settings__nav-item")
      .allInnerTexts();
    expect(navLabels.length).toBeGreaterThan(0);
    for (const label of navLabels) {
      expect(label.trim()).not.toMatch(/^settings_/);
    }
  });

  test("plural-bearing message renders the correct plural form (Audit Log event count)", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/audit");

    // The mock audit fixture has 5 entries → `settings_auditlog_event_count`
    // must select the `pp=other` branch ("5 events"), proving Paraglide plural
    // resolution — not the singular "5 event" nor a raw-key render.
    await expect(page.getByText("5 events")).toBeVisible();
    await expect(page.getByText(/\b5 event\b(?! s)/)).toHaveCount(0);
  });
});

// ── Scenario 5 — Bottom log viewer (spec 019) ───────────────────────────────

test.describe("Journey 10 · Bottom log viewer (spec 019)", () => {
  test("opening the log panel renders entries; level filter + Escape-close behave", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/sessions");

    // Panel starts collapsed (Shell renders it only while expanded). Open it
    // via the status-bar toggle.
    const logRegion = page.getByRole("log", { name: "Operation log" });
    await expect(logRegion).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle log panel" }).click();
    await expect(logRegion).toBeVisible();

    // Seeded mock entries render (MOCK_LOG_ENTRIES).
    await expect(
      logRegion.getByText("Scan completed: 1,247 files indexed"),
    ).toBeVisible();
    const errorMsg =
      "Failed to read: /raw/2026-04-17/frame_0043.fit — permission denied";
    await expect(logRegion.getByText(errorMsg)).toBeVisible();

    // Controls present (FR-003 level chips + FR-007 JSON export, follow-tail).
    for (const chip of ["All", "Error", "Warn", "Info", "Debug"]) {
      await expect(
        logRegion.getByRole("button", { name: chip, exact: true }),
      ).toBeVisible();
    }
    await expect(
      logRegion.getByRole("button", { name: "Export log to JSON file" }),
    ).toBeVisible();

    // Truncation marker is NOT reachable in mock mode (documented above):
    // assert its honest absence rather than fabricating a truncated buffer.
    await expect(page.locator(".alm-logpanel__truncation-marker")).toHaveCount(0);

    // Level filter behaves: selecting "Error" hides non-error entries.
    await logRegion.getByRole("button", { name: "Error", exact: true }).click();
    await expect(logRegion.getByText(errorMsg)).toBeVisible();
    await expect(
      logRegion.getByText("Scan completed: 1,247 files indexed"),
    ).toHaveCount(0);

    // Escape closes the panel (Shell unmounts it).
    await page.keyboard.press("Escape");
    await expect(logRegion).toHaveCount(0);
  });
});

// ── Scenario 6 — Whole-app zoom envelope pins (spec 055 FR-006, T032) ───────
//
// Mock-mode Playwright has no Tauri engine to drive real `setZoom` (T030's
// `getCurrentWebview().setZoom` no-ops outside Tauri — see data/theme.ts
// `applyEngineZoom`). Engine zoom shrinks the *reported* CSS viewport by the
// zoom factor without CSS reflow bugs, so a viewport pre-shrunk by the same
// factor is a faithful CI-reachable proxy for "does the layout survive at
// this zoom level" (the actual multiply-by-webview-zoom mechanism is
// Tauri-native and covered by the `verify-on-windows` scenario instead).
//
// Both pins below emulate the same 880x576 CSS viewport by construction
// (1100/1.25 = 880x576; 1320/1.5 = 880x576) — the min-window x125% pin and
// the enlarged-window x150% pin are deliberately chosen so they still land
// inside the accepted envelope; min-window x150% (733px) is documented in
// the spec as accepted degradation, not guarded here.
test.describe("Journey 10 · Whole-app zoom envelope pins (spec 055 FR-006)", () => {
  const OVERFLOW_TOLERANCE_PX = 2;

  async function assertShellIntactNoHorizontalOverflow(page: Page): Promise<void> {
    await expect(page.locator(".alm-sidebar")).toBeVisible();
    await expect(page.locator(".alm-page__bar").first()).toBeVisible();
    await expect(page.locator(".alm-frame__main")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const doc = document.scrollingElement!;
      return doc.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
  }

  test("1100x720 min window at 125% zoom equivalent (880x576) — shell intact, no horizontal overflow", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.setViewportSize({ width: 880, height: 576 });
    await page.goto("/#/settings/general");
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();

    await assertShellIntactNoHorizontalOverflow(page);
  });

  test("1320x864 window at 150% zoom equivalent (880x576) — shell intact, no horizontal overflow", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.setViewportSize({ width: 880, height: 576 });
    await page.goto("/#/targets");
    await expect(page.locator(".alm-sidebar")).toBeVisible();

    await assertShellIntactNoHorizontalOverflow(page);
  });
});

// ── Scenario 7 — Appearance "Restore defaults" adoption (#802) ──────────────

test.describe("Journey 10 · Appearance Restore defaults (#802)", () => {
  test("Restore defaults resets a changed theme back to System", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/general");
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Espresso" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "espresso-dark",
    );

    await page
      .getByRole("button", { name: "Restore defaults", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "System" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

// ── Scenario 8 — Advanced > Guided Tour restart confirm gate (#827) ─────────

test.describe("Journey 10 · Advanced Guided Tour restart gate (#827)", () => {
  test("'Restart guided flow' requires confirmation and shows success feedback, matching 'Restart first-run setup'", async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto("/#/settings/advanced");

    const restartBtn = page.getByTestId("guided-restart-btn");
    await expect(restartBtn).toBeVisible();

    // Clicking must not fire the restart directly — a confirm step gates it,
    // symmetric with the "Restart first-run setup" control below it.
    await restartBtn.click();
    const confirmBtn = page.getByTestId("guided-restart-confirm-btn");
    await expect(confirmBtn).toBeVisible();
    await expect(page.getByTestId("guided-restart-done")).toHaveCount(0);

    await confirmBtn.click();
    await expect(page.getByTestId("guided-restart-done")).toBeVisible();
  });
});
