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
 *     `data-theme` on <html>, persisted in `localStorage['pv.theme']`; the
 *     page-layout convention (`.pv-page__bar` pinned, content scroll region
 *     `overflow-y:auto` — action bar always visible, only content scrolls).
 *   - 046 (i18n / error-codes): Paraglide baseLocale catalog — every `settings_*`
 *     key resolves to a human string (no raw-key fallback leaks) and a
 *     plural-bearing message renders the correct plural form.
 *   - 061 (selectable app language, US2): Settings → Appearance gains a
 *     Language control (FR-004's old "hard-pinned English, no switcher" is
 *     superseded). Changing it re-renders live (no reload, D2) and persists
 *     across a restart (D8).
 *   - 019 (bottom log viewer): full-width fold-out log panel, level filter
 *     chips, follow-tail + export controls, Escape-to-close. FR-001/003/007.
 *
 * All assertions run against the mock IPC layer (`VITE_USE_MOCKS=true`, pinned
 * by playwright.config.ts). Settings persistence is exercised through the
 * arg-sensitive settings mocks: `ingestion_settings_update` mutates the
 * module-level `mockIngestionSettings` fixture that `ingestion_settings_get`
 * re-reads (spec 030 P12), and the Cleanup per-type table round-trips through
 * `localStorage['pv.cleanup.type_actions.v2']`.
 *
 * Mock-mode honesty notes (Layer-2-only flows, NOT asserted here):
 *   - The log panel's truncation marker (`logpanel_history_gap*`) is not
 *     reachable in mock mode: `startLogSubscription` seeds MOCK_LOG_ENTRIES
 *     directly and never marks the buffer truncated (only a real backend
 *     `log_recent` with `truncated:true` triggers it). This file asserts the
 *     marker is ABSENT and exercises the reachable controls instead.
 *   - `settings_update('general', …)` is a no-op in the mock IPC layer (only
 *     the `observing`/`cleanup`/`framing` scopes round-trip — see
 *     `apps/desktop/src/api/mocks.ts`), so a real settings-DB round-trip for
 *     `locale` cannot be proven here; that is what the Rust Layer-1 test
 *     (`crates/app/core/tests/`, spec 061 T004) is for. What this file CAN
 *     and does prove is the frontend half: the `localStorage['pv.locale']`
 *     mirror survives a real `page.reload()`, and the UI re-hydrates from
 *     that stored value rather than merely accepting a command that returned
 *     `Ok` (research D8) — the same honest split already used by the
 *     Appearance theme "survives a full reload" test below, which is
 *     localStorage-only for the identical reason.
 *   - pt-BR is a 5-key stub (`common_all`/`common_yes`/`common_no`/
 *     `common_cancel`/`common_save` — spec 061 US3 is the rest); the
 *     translation-propagation checks below use `common_all` (visible as the
 *     Audit Log outcome filter's default selection) because it is the only
 *     currently-translated string reachable without extra setup.
 */
import {
  test,
  expect,
  seedSetupComplete,
  disableOnboarding,
  assertDefined,
} from './support/harness';
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

    // Issue #878: only followSymlinks has a scan-pipeline consumer
    // (`inbox.scan.folder` → `app_core::inbox_scan::resolve_scan_options`).
    // The other three controls (scan on startup, follow NTFS junctions,
    // hashing mode) render disabled — they must not misrepresent themselves
    // as working settings — so the round-trip proof below exercises
    // followSymlinks instead of the now-disabled hashing-mode selector.
    const hashing = page.getByLabel('Hashing mode');
    await expect(hashing).toBeDisabled();

    const followSymlinks = page.getByLabel('Follow symbolic links');
    // Current (seeded) value from mockIngestionSettings: default-off, per the
    // product rule that scans must not follow symlinks/junctions unless the
    // user explicitly opts in.
    await expect(followSymlinks).not.toBeChecked();

    // Edit → auto-save (FR-004: no global Save button). The underlying
    // checkbox is zero-size and visually hidden
    // (`.pv-toggle input { opacity: 0; width: 0; height: 0 }`) behind the
    // track/thumb it drives, so a real click lands on the wrapping
    // `<label class="pv-toggle">`, not the input itself. Toggling fires
    // `ingestion_settings_update`, which mutates the mock fixture.
    await followSymlinks.locator('xpath=..').click();
    await expect(followSymlinks).toBeChecked();

    // Round-trip proof: leave the pane (Ingestion unmounts) and return
    // (it re-mounts and re-fetches via `ingestion_settings_get`). The value
    // must survive because the mock persisted it, not because component state
    // lingered.
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ingestion', exact: true }).click();

    const followSymlinksAfter = page.getByLabel('Follow symbolic links');
    await expect(followSymlinksAfter).toBeAttached();
    await expect(followSymlinksAfter).toBeChecked();
  });

  test('Cleanup pane edits the real cleanup policy and persists it via the cleanup_policy mock round-trip', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/cleanup');

    // The policy `cleanup_scan`/`cleanup_plan_generate` actually read (#804).
    // Replaced the former 15-row CLEANUP_TYPES fixture table, which wrote a
    // `cleanupTypeOverrides` blob no scan path consulted.
    await expect(
      page.getByText('Cleanup Policy', { exact: true }),
    ).toBeVisible();

    // Every data type defaults to Keep (mirrors `default_cleanup_policy()`);
    // flip intermediates to Archive so the change is observable. Fires
    // `cleanup_policy_update`, not `settings_update`.
    const row = page
      .locator('[data-testid="settings-row"]')
      .filter({ hasText: 'Intermediate files' });
    await expect(row).toBeVisible();
    // SegControl renders WAI-ARIA radio-group semantics (#1010): options are
    // role="radio", not role="button".
    await expect(row.getByRole('radio', { name: 'Keep' })).toHaveClass(
      /pv-seg__btn--active/,
    );
    // Cleanup's mount effect fires `cleanup_policy_get` (mock IPC has a
    // randomized 50-150ms artificial latency, see `apps/desktop/src/api/mocks.ts`
    // `mockInvoke`'s `delay(50 + random*100)`). That in-flight fetch must not
    // resolve after this click and clobber the just-set local state back to
    // "Keep" — Cleanup.tsx tracks whether a policy edit happened and ignores a
    // mount fetch that resolves afterwards, so a single click+assert suffices.
    await row.getByRole('radio', { name: 'Archive' }).click();
    await expect(row.getByRole('radio', { name: 'Archive' })).toHaveClass(
      /pv-seg__btn--active/,
      { timeout: 15_000 },
    );

    // Round-trip proof: leave the pane (Cleanup unmounts) and return (it
    // re-mounts and re-fetches via `cleanup_policy_get`). The value must
    // survive because the mock persisted it, not because component state
    // lingered — mirrors the Ingestion pane proof above. The policy writes
    // straight through `cleanup_policy_update` (no useAutoSave debounce), so
    // no settle wait is needed before navigating away.
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cleanup', exact: true }).click();

    const rowAfter = page
      .locator('[data-testid="settings-row"]')
      .filter({ hasText: 'Intermediate files' });
    await expect(rowAfter).toBeVisible();
    // No stomp risk here (single cleanup_policy_get after remount, no competing
    // local click) — just the same mock IPC latency, so a longer read-only
    // wait is sufficient.
    await expect(rowAfter.getByRole('radio', { name: 'Archive' })).toHaveClass(
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
// Swatch buttons expose the shared ThemePicker's explicit
// `<theme> · <mode>` accessible-name contract. Keep every case anchored so
// e.g. "Observatory" cannot accidentally match "Observatory Cool".
const THEME_CASES: { name: RegExp; dataTheme: string }[] = [
  { name: /^Warm Slate · light$/i, dataTheme: 'warm-slate' },
  { name: /^Observatory · dark$/i, dataTheme: 'observatory-dark' },
  {
    name: /^Observatory Cool · light$/i,
    dataTheme: 'observatory-cool-light',
  },
  { name: /^Observatory Cool · dark$/i, dataTheme: 'observatory-cool' },
];

const THEME_TOKEN_CASES = [
  {
    dataTheme: 'espresso-dark',
    ink: '#ece7df',
    background: '#161412',
    controlBorder: '#726f6a',
  },
  {
    dataTheme: 'observatory-cool-light',
    ink: '#191d24',
    background: '#f2f4f8',
    controlBorder: '#7b7f86',
  },
  {
    dataTheme: 'observatory-cool',
    ink: '#eef2f7',
    background: '#12151b',
    controlBorder: '#6f7379',
  },
  {
    dataTheme: 'observatory-dark',
    ink: '#f0ebe2',
    background: '#1b1916',
    controlBorder: '#76736b',
  },
  {
    dataTheme: 'warm-clay',
    ink: '#221f1a',
    background: '#f6f4ef',
    controlBorder: '#817d77',
  },
  {
    dataTheme: 'warm-slate',
    ink: '#20211f',
    background: '#f5f4f1',
    controlBorder: '#7d7d7a',
  },
] as const;

test.describe('Journey 10 · Appearance / 4 themes (spec 043)', () => {
  test('each named theme and the no-attribute fallback resolve their own palette in Chromium', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');

    const actual = await page.evaluate(
      (themeIds) => {
        const root = document.documentElement;
        const semanticProbe = document.createElement('div');
        semanticProbe.style.color = 'var(--pv-text)';
        semanticProbe.style.backgroundColor = 'var(--pv-bg)';
        semanticProbe.style.border = '1px solid var(--pv-control-border)';

        const rawProbe = document.createElement('div');
        document.body.append(semanticProbe, rawProbe);

        const readPalette = () => {
          const rootStyle = getComputedStyle(root);
          const raw = {
            ink: rootStyle.getPropertyValue('--pv-ink').trim(),
            background: rootStyle.getPropertyValue('--pv-bg').trim(),
            controlBorder: rootStyle
              .getPropertyValue('--pv-control-border')
              .trim(),
          };
          rawProbe.style.color = raw.ink;
          rawProbe.style.backgroundColor = raw.background;
          rawProbe.style.border = `1px solid ${raw.controlBorder}`;

          const semanticStyle = getComputedStyle(semanticProbe);
          const rawStyle = getComputedStyle(rawProbe);
          return {
            raw,
            semantic: {
              ink: semanticStyle.color,
              background: semanticStyle.backgroundColor,
              controlBorder: semanticStyle.borderTopColor,
            },
            resolvedRaw: {
              ink: rawStyle.color,
              background: rawStyle.backgroundColor,
              controlBorder: rawStyle.borderTopColor,
            },
          };
        };

        const named = themeIds.map((dataTheme) => {
          root.setAttribute('data-theme', dataTheme);
          return { dataTheme, ...readPalette() };
        });
        root.removeAttribute('data-theme');
        const fallback = readPalette();
        semanticProbe.remove();
        rawProbe.remove();
        return { named, fallback };
      },
      THEME_TOKEN_CASES.map(({ dataTheme }) => dataTheme),
    );

    for (const expected of THEME_TOKEN_CASES) {
      const theme = assertDefined(
        actual.named.find(({ dataTheme }) => dataTheme === expected.dataTheme),
        `${expected.dataTheme} computed palette`,
      );
      expect(theme.raw).toEqual({
        ink: expected.ink,
        background: expected.background,
        controlBorder: expected.controlBorder,
      });
      expect(theme.semantic).toEqual(theme.resolvedRaw);
    }

    const warmSlate = assertDefined(
      THEME_TOKEN_CASES.find(({ dataTheme }) => dataTheme === 'warm-slate'),
      'warm-slate token case',
    );
    expect(actual.fallback.raw).toEqual({
      ink: warmSlate.ink,
      background: warmSlate.background,
      controlBorder: warmSlate.controlBorder,
    });
    expect(actual.fallback.semantic).toEqual(actual.fallback.resolvedRaw);
  });

  test('switching among the 4 themes updates data-theme on <html> and persists', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    await expect(page.getByText('Theme', { exact: true })).toBeVisible();

    // System + the 4 canonical (warm × 2, cool × 2) themes = 5 swatch cards.
    // Warm Clay/Espresso Dark stay in the registry (still resolve/persist if
    // already chosen — see theme.persistence.test.ts) but no longer render.
    const swatches = page.locator('[data-testid="theme-swatch"]');
    await expect(swatches).toHaveCount(5);

    for (const theme of THEME_CASES) {
      await page.getByRole('button', { name: theme.name }).click();
      // The appearance runtime writes data-theme on the document root.
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        theme.dataTheme,
      );
      // Choice is persisted in localStorage under `pv.theme`.
      const stored = await page.evaluate(() =>
        localStorage.getItem('pv.theme'),
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
      .getByRole('button', { name: /^Observatory Cool · dark$/i })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'observatory-cool',
    );

    // #794 repro: switch theme, then navigate away — the choice must not
    // silently revert to the resolved-system dark default.
    await page.goto('/#/targets');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
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

// ── Scenario 2b — Language switcher (spec 061 US2) ──────────────────────────

test.describe('Journey 10 · Language switcher (spec 061 US2)', () => {
  test('renders flag + native name per option, is keyboard-operable, and exposes native-name-only accessible names', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');
    // The group title and the row label both read "Language" (the row is
    // this group's only control) — `getByText(exact)` would match both, so
    // scope to the group heading specifically.
    await expect(
      page.locator('[data-testid="settings-group-title"]', {
        hasText: 'Language',
      }),
    ).toBeVisible();

    // FR-007: flag + native name both render as visible text.
    const english = page.getByRole('radio', { name: 'English (UK)' });
    const portuguese = page.getByRole('radio', { name: 'Português (Brasil)' });
    await expect(english).toBeVisible();
    await expect(portuguese).toBeVisible();
    await expect(english).toContainText('🇬🇧');
    await expect(english).toContainText('English (UK)');
    await expect(portuguese).toContainText('🇧🇷');
    await expect(portuguese).toContainText('Português (Brasil)');

    // Research D6: the accessible name (the `name` used above to find each
    // radio) is the native name alone — Playwright's role/name lookup would
    // not have matched 'English (UK)' at all if the flag were folded into
    // the accessible name, since the query is exact-role-name matching.

    // en-GB is the base locale — starts selected.
    await expect(english).toHaveAttribute('aria-checked', 'true');
    await expect(portuguese).toHaveAttribute('aria-checked', 'false');

    // Keyboard operability (FR-008): the WAI-ARIA radiogroup pattern moves
    // both focus and selection with arrow keys (SegControl, #1010).
    await english.focus();
    await page.keyboard.press('ArrowRight');
    await expect(portuguese).toHaveAttribute('aria-checked', 'true');
    await expect(portuguese).toBeFocused();
  });

  test('changing the language re-renders Settings live, with no reload (research D2)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/');

    // Open the bottom log panel first — Shell (and its expanded/collapsed
    // state) wraps every route, so this state only survives a language
    // change if `changeLocale` genuinely never triggers Paraglide's default
    // `setLocale` reload path.
    await page.getByRole('button', { name: 'Toggle log panel' }).click();
    const logRegion = page.getByRole('log', { name: 'Operation log' });
    await expect(logRegion).toBeVisible();

    await page.goto('/#/settings/general');
    await page.getByRole('radio', { name: 'Português (Brasil)' }).click();
    await expect(
      page.getByRole('radio', { name: 'Português (Brasil)' }),
    ).toHaveAttribute('aria-checked', 'true');

    // No reload happened: the Shell-level log panel (opened before the
    // language change, on an unrelated page) is still expanded.
    await expect(logRegion).toBeVisible();

    // Live re-render, not just local state in the language control itself:
    // a SIBLING pane's `common_all()` call (pt-BR translates it to "Todos")
    // must reflect the change too, without navigating away and back. A
    // <select>'s `textContent` concatenates every <option>, so the proof is
    // the translated <option> existing in this specific select, not a
    // display-value check. The nav item and the filter label are matched in
    // Portuguese, not English — SettingsPageBody subscribes to the locale
    // context (per the commit that added it), so the whole nav and every
    // pane re-render live in pt-BR the moment the radio above is clicked.
    await page.getByRole('button', { name: 'Registro de auditoria' }).click();
    const outcomeFilter = page.getByLabel('Resultado').first();
    await expect(outcomeFilter).toHaveValue('');
    await expect(
      outcomeFilter.locator('option', { hasText: 'Todos' }),
    ).toHaveCount(1);
  });

  test('language choice persists across a reload (research D8 — the stored value, not just a resolved Ok)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/general');

    await page.getByRole('radio', { name: 'Português (Brasil)' }).click();
    await expect(
      page.getByRole('radio', { name: 'Português (Brasil)' }),
    ).toHaveAttribute('aria-checked', 'true');
    const stored = await page.evaluate(() => localStorage.getItem('pv.locale'));
    expect(stored).toBe('pt-BR');

    await page.reload();

    // The persisted mirror value — not a fresh default — drives the
    // re-hydrated selection.
    const storedAfter = await page.evaluate(() =>
      localStorage.getItem('pv.locale'),
    );
    expect(storedAfter).toBe('pt-BR');
    await expect(
      page.getByRole('radio', { name: 'Português (Brasil)' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

// ── Scenario 3 — Layout convention (spec 043) ───────────────────────────────

test.describe('Journey 10 · Page-layout convention (spec 043)', () => {
  // The Settings Naming & Structure pane renders the per-frame-type
  // destination-pattern editor (`PerTypeDestinationPatterns`), so its content
  // region (`.pv-two-pane__detail`, overflow-y:auto) genuinely overflows at
  // 720px — making it a faithful probe for "action bar always visible, only
  // content scrolls". Cleanup used to be this probe, but #804 replaced its
  // 15-row fixture table with a 3-row policy control that no longer overflows
  // at 720px — switched the probe pane rather than weakening this assertion.
  async function assertBarPinnedWhileContentScrolls(
    page: Page,
    height: number,
  ): Promise<void> {
    await page.setViewportSize({ width: 1100, height });

    const bar = page
      .locator('[data-testid="page-bar"], [data-testid="topbar"]')
      .first();
    await expect(bar).toBeVisible();
    const barBoxBefore = assertDefined(
      await bar.boundingBox(),
      'action bar boundingBox before scroll',
    );

    const scroller = page.locator('[data-testid="two-pane-detail"]').first();
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
    const barBoxAfter = assertDefined(
      await bar.boundingBox(),
      'action bar boundingBox after scroll',
    );
    expect(Math.round(barBoxAfter.y)).toBe(Math.round(barBoxBefore.y));
  }

  test('action bar stays pinned while only the content region scrolls (1100x720 and a shorter height)', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/settings/naming');
    await expect(
      page.getByText('Project Folder Pattern', { exact: true }),
    ).toBeVisible();
    // The top action bar carries the page title.
    await expect(
      page
        .locator('[data-testid="page-bar"]')
        .getByText('Settings', { exact: true }),
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
      page
        .locator('[data-testid="page-bar"]')
        .getByText('Settings', { exact: true }),
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
      .locator('[data-testid="settings-nav-item"]')
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
    await expect(
      page.locator('[data-testid="logpanel-truncation-marker"]'),
    ).toHaveCount(0);

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
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="page-bar"], [data-testid="topbar"]').first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="frame-main"]')).toBeVisible();

    const overflow = await page.evaluate(() => {
      // Runs in-browser (page.evaluate serializes this closure), so it can't
      // reach the Node-side assertDefined helper — narrow inline instead.
      const doc = document.scrollingElement;
      if (!doc) throw new Error('document.scrollingElement is null');
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
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

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
      .getByRole('button', { name: /^Observatory Cool · dark$/i })
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
