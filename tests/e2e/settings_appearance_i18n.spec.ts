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
 *     page-layout convention (`.pv-page__bar` pinned, content scroll region
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
import { test, expect, seedSetupComplete, disableOnboarding } from './support/harness';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await disableOnboarding(page);
});

// ── Scenario 1 — Settings config model persists (spec 018) ──────────────────

test.describe('Journey 10 · Settings configuration model (spec 018)', () => {
  test('Ingestion pane loads current values, edits, and PERSISTS via the settings mock round-trip', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/ingestion');

    // Pane loaded: section title + a representative one-setting-per-line row
    // (FR-002). Settings section titles are styled <div>s, not heading roles.
    await expect(
      page.getByText('Scan defaults', { exact: true }),
    ).toBeVisible();
    const hashing = page.getByLabel('Hashing mode');
    // Current (seeded) value from mockIngestionSettings.
    await expect(hashing).toHaveValue('lazy');

    // Edit → auto-save (FR-004: no global Save button). Selecting the option
    // fires `ingestion_settings_update`, which mutates the mock fixture.
    await hashing.selectOption('eager');
    await expect(hashing).toHaveValue('eager');

    // Round-trip proof: leave the pane (Ingestion unmounts) and return
    // (it re-mounts and re-fetches via `ingestion_settings_get`). The value
    // must survive because the mock persisted it, not because component state
    // lingered.
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ingestion', exact: true }).click();

    const hashingAfter = page.getByLabel('Hashing mode');
    await expect(hashingAfter).toBeVisible();
    await expect(hashingAfter).toHaveValue('eager');
  });

  test('Cleanup pane renders the per-type override table and persists an override via the settings mock round-trip', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/cleanup');

    // Per-type action table present (spec 018 cleanup override surface).
    await expect(
      page.getByText('Per-Type Default Actions', { exact: true }),
    ).toBeVisible();

    // "Raw dark frames" defaults to "Archive"; flip it to "Keep" (a non-default
    // choice, so the override is observable). This now fires
    // `settings_update('cleanup', { cleanupTypeOverrides })` (spec 051 US3),
    // not a localStorage write.
    const row = page.getByRole('row').filter({ hasText: 'Raw dark frames' });
    await expect(row).toBeVisible();
    // SegControl renders WAI-ARIA radio-group semantics (#1010): options are
    // role="radio", not role="button".
    await expect(row.getByRole('radio', { name: 'Archive' })).toHaveClass(
      /pv-seg__btn--active/,
    );
    // Cleanup's mount effect fires `settings_get('cleanup')` (mock IPC has a
    // randomized 50-150ms artificial latency, see `apps/desktop/src/api/mocks.ts`
    // `mockInvoke`'s `delay(50 + random*100)`). That in-flight fetch used to be
    // able to resolve AFTER this click and clobber the just-set local state
    // back to "Archive"; Cleanup.tsx now tracks whether an edit happened and
    // ignores a mount fetch that resolves afterwards, so a single click+assert
    // is sufficient (no retry needed).
    await row.getByRole('radio', { name: 'Keep' }).click();
    await expect(row.getByRole('radio', { name: 'Keep' })).toHaveClass(
      /pv-seg__btn--active/,
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
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cleanup', exact: true }).click();

    const rowAfter = page
      .getByRole('row')
      .filter({ hasText: 'Raw dark frames' });
    await expect(rowAfter).toBeVisible();
    // No stomp risk here (single settings_get after remount, no competing
    // local click) — just the same mock IPC latency, so a longer read-only
    // wait is sufficient.
    await expect(rowAfter.getByRole('radio', { name: 'Keep' })).toHaveClass(
      /pv-seg__btn--active/,
      { timeout: 15_000 },
    );
  });
});

// ── Scenario 2 — Appearance / 4 themes (spec 043) ───────────────────────────

// Handoff 03 (design refresh): the picker now shows only the 4 canonical
// themes (2 warm + 2 cool families) — Warm Clay/Espresso Dark are disabled
// (registry-only) variants, hidden from the picker DOM entirely
// (apps/desktop/src/features/settings/General.tsx WARM_CHOICES/COOL_CHOICES).
// Swatch buttons' accessible name concatenates the theme-name span and the
// mode span with no guaranteed literal space between them (differs slightly
// between jsdom/testing-library and a real Chromium AX tree) — every case
// below is a RegExp with an optional `\s*` at the join point so it matches
// either rendering, anchored so e.g. "Observatory" (warm, dark) can't
// accidentally match "Observatory Cool" (cool, dark/light).
const THEME_CASES: { name: RegExp; dataTheme: string }[] = [
  { name: /^Warm Slate\s*light$/i, dataTheme: 'warm-slate' },
  { name: /^Observatory\s*dark$/i, dataTheme: 'observatory-dark' },
  {
    name: /^Observatory Cool · Light\s*light$/i,
    dataTheme: 'observatory-cool-light',
  },
  { name: /^Observatory Cool\s*dark$/i, dataTheme: 'observatory-cool' },
];

test.describe('Journey 10 · Appearance / 4 themes (spec 043)', () => {
  test('switching among the 4 themes updates data-theme on <html> and persists', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();

    // System + the 4 canonical (warm × 2, cool × 2) themes = 5 swatch cards.
    // Warm Clay/Espresso Dark stay in the registry (still resolve/persist if
    // already chosen — see theme.persistence.test.ts) but no longer render.
    const swatches = page.locator('.pv-theme-swatch');
    await expect(swatches).toHaveCount(5);

    for (const theme of THEME_CASES) {
      await page.getByRole('button', { name: theme.name }).click();
      // The appearance runtime writes data-theme on the document root.
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        theme.dataTheme,
      );
      // Choice is persisted in localStorage under `alm.theme`.
      const stored = await page.evaluate(() =>
        localStorage.getItem('alm.theme'),
      );
      expect(stored).toBe(theme.dataTheme);
    }
  });

  test('theme choice survives navigating away from Settings (#794)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    // Warm Clay is a disabled (picker-hidden) variant as of handoff 03 —
    // Observatory Cool (canonical, cool/dark) exercises the same non-default
    // explicit-choice path.
    await page
      .getByRole('button', { name: /^Observatory Cool\s*dark$/i })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool',
    );

    // #794 repro: switch theme, then navigate away — the choice must not
    // silently revert to the resolved-system dark default.
    await page.goto('/#/targets');
    await expect(page.locator('.pv-sidebar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool',
    );
  });

  test('theme choice survives a full reload (applied at boot via initAppearance)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    // Espresso Dark is a disabled (picker-hidden) variant as of handoff 03 —
    // Observatory Cool · Light (canonical, cool/light) exercises the same
    // reload-survival path.
    await page
      .getByRole('button', { name: 'Observatory Cool · Light' })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool-light',
    );

    await page.reload();
    // Boot-time initAppearance() re-applies the persisted theme before render.
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool-light',
    );
  });
});

// ── Scenario 3 — Layout convention (spec 043) ───────────────────────────────

test.describe('Journey 10 · Page-layout convention (spec 043)', () => {
  // The Settings Cleanup pane has a long per-type table, so its content region
  // (`.pv-two-pane__detail`, overflow-y:auto) actually overflows at 720px —
  // making it a faithful probe for "action bar always visible, only content
  // scrolls".
  async function assertBarPinnedWhileContentScrolls(
    page: Page,
    height: number,
  ): Promise<void> {
    await page.setViewportSize({ width: 1100, height });

    const bar = page.locator('.pv-page__bar').first();
    await expect(bar).toBeVisible();
    const barBoxBefore = await bar.boundingBox();
    expect(barBoxBefore).not.toBeNull();

    const scroller = page.locator('.pv-two-pane__detail').first();
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

  test('action bar stays pinned while only the content region scrolls (1100x720 and a shorter height)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/cleanup');
    await expect(
      page.getByText('Per-Type Default Actions', { exact: true }),
    ).toBeVisible();
    // The top action bar carries the page title.
    await expect(
      page.locator('.pv-page__bar').getByText('Settings', { exact: true }),
    ).toBeVisible();

    await assertBarPinnedWhileContentScrolls(page, 720);
    await assertBarPinnedWhileContentScrolls(page, 500);
  });
});

// ── Scenario 4 — i18n (spec 046) ────────────────────────────────────────────

test.describe('Journey 10 · i18n catalog (spec 046)', () => {
  test('Settings renders human strings — no raw message-key fallbacks leak', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/sources');

    // Known keys must resolve to their English strings, not literal keys.
    await expect(
      page.locator('.pv-page__bar').getByText('Settings', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Data Sources', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Appearance', exact: true }),
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
      .locator('.pv-settings__nav-item')
      .allInnerTexts();
    expect(navLabels.length).toBeGreaterThan(0);
    for (const label of navLabels) {
      expect(label.trim()).not.toMatch(/^settings_/);
    }
  });

  test('plural-bearing message renders the correct plural form (Audit Log event count)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/audit');

    // The mock audit fixture has 5 entries → `settings_auditlog_event_count`
    // must select the `pp=other` branch ("5 events"), proving Paraglide plural
    // resolution — not the singular "5 event" nor a raw-key render.
    await expect(page.getByText('5 events')).toBeVisible();
    await expect(page.getByText(/\b5 event\b(?! s)/)).toHaveCount(0);
  });
});

// ── Scenario 5 — Bottom log viewer (spec 019) ───────────────────────────────

test.describe('Journey 10 · Bottom log viewer (spec 019)', () => {
  test('opening the log panel renders entries; level filter + Escape-close behave', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/sessions');

    // Panel starts collapsed (Shell renders it only while expanded). Open it
    // via the status-bar toggle.
    const logRegion = page.getByRole('log', { name: 'Operation log' });
    await expect(logRegion).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle log panel' }).click();
    await expect(logRegion).toBeVisible();

    // Seeded mock entries render (MOCK_LOG_ENTRIES).
    await expect(
      logRegion.getByText('Scan completed: 1,247 files indexed'),
    ).toBeVisible();
    const errorMsg =
      'Failed to read: /raw/2026-04-17/frame_0043.fit — permission denied';
    await expect(logRegion.getByText(errorMsg)).toBeVisible();

    // Controls present (FR-003 level chips + FR-007 JSON export, follow-tail).
    // "All" is disambiguated via aria-label (#666 added a second filter
    // group, also with a visible "All" chip) — assert both by their
    // distinct accessible names rather than the shared visible text.
    await expect(
      logRegion.getByRole('button', { name: 'All levels', exact: true }),
    ).toBeVisible();
    for (const chip of ['Error', 'Warn', 'Info', 'Debug']) {
      await expect(
        logRegion.getByRole('button', { name: chip, exact: true }),
      ).toBeVisible();
    }
    await expect(
      logRegion.getByRole('button', { name: 'Export log to JSON file' }),
    ).toBeVisible();

    // Category/source filter (#666) — same visible "All" text as the level
    // filter, disambiguated by aria-label; a real source chip is present.
    await expect(
      logRegion.getByRole('button', { name: 'All sources', exact: true }),
    ).toBeVisible();
    await expect(
      logRegion.getByRole('button', { name: 'target', exact: true }),
    ).toBeVisible();

    // Truncation marker is NOT reachable in mock mode (documented above):
    // assert its honest absence rather than fabricating a truncated buffer.
    await expect(page.locator('.pv-logpanel__truncation-marker')).toHaveCount(
      0,
    );

    // Level filter behaves: selecting "Error" hides non-error entries.
    await logRegion.getByRole('button', { name: 'Error', exact: true }).click();
    await expect(logRegion.getByText(errorMsg)).toBeVisible();
    await expect(
      logRegion.getByText('Scan completed: 1,247 files indexed'),
    ).toHaveCount(0);

    // Escape closes the panel (Shell unmounts it).
    await page.keyboard.press('Escape');
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
test.describe('Journey 10 · Whole-app zoom envelope pins (spec 055 FR-006)', () => {
  const OVERFLOW_TOLERANCE_PX = 2;

  async function assertShellIntactNoHorizontalOverflow(
    page: Page,
  ): Promise<void> {
    await expect(page.locator('.pv-sidebar')).toBeVisible();
    await expect(page.locator('.pv-page__bar').first()).toBeVisible();
    await expect(page.locator('.pv-frame__main')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const doc = document.scrollingElement!;
      return doc.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
  }

  test('1100x720 min window at 125% zoom equivalent (880x576) — shell intact, no horizontal overflow', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.setViewportSize({ width: 880, height: 576 });
    await page.goto('/#/settings/general');
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();

    await assertShellIntactNoHorizontalOverflow(page);
  });

  test('1320x864 window at 150% zoom equivalent (880x576) — shell intact, no horizontal overflow', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.setViewportSize({ width: 880, height: 576 });
    await page.goto('/#/targets');
    await expect(page.locator('.pv-sidebar')).toBeVisible();

    await assertShellIntactNoHorizontalOverflow(page);
  });
});

// ── Scenario 7 — Appearance "Restore defaults" adoption (#802) ──────────────

test.describe('Journey 10 · Appearance Restore defaults (#802)', () => {
  test('Restore defaults resets a changed theme back to System', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();

    // Espresso Dark is a disabled (picker-hidden) variant as of handoff 03 —
    // Observatory Cool (canonical, cool/dark) exercises the same
    // restore-to-System path.
    await page
      .getByRole('button', { name: /^Observatory Cool\s*dark$/i })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool',
    );

    await page
      .getByRole('button', { name: 'Restore defaults', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

// ── Scenario 8 — REMOVED: Advanced > Guided Tour restart gate (#827) ────────
//
// The spec-010 guided flow is deleted by spec 056, taking `guided-restart-btn`
// and its confirm gate with it. The user-facing capability — re-run orientation
// from Settings → Advanced — survives on `onboarding-replay-btn` (FR-005/T015),
// so Journey 10 keeps this coverage; it just lives with the rest of the
// onboarding suite now:
//
//   tests/e2e/onboarding_orientation.spec.ts
//     "replays from Settings → Advanced, ignoring the done flag"
//   tests/e2e/onboarding_removal.spec.ts
//     "Settings → Advanced renders the restore control ... (T030)"
//
// It is NOT re-homed here: this file's `beforeEach` calls `disableOnboarding`,
// so no onboarding surface renders for any test in it. A replay assertion added
// here could only ever pass vacuously.
//
// #827's confirm gate is deliberately not carried forward. It existed for
// symmetry with "Restart first-run setup", but the two differ in consequence:
// restarting first-run setup discards setup state, whereas replaying the walk
// is non-destructive and dismissible at any stop. If replay ever gains a
// destructive side effect, the gate should come back with it.
