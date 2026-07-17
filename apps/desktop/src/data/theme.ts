// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Appearance runtime — theme + density + font size (PlateVault redesign).
//
// Theme is applied as a `data-theme` attribute on <html>; tokens.css defines
// one scope per theme. `system` follows the OS via prefers-color-scheme.
// Density mirrors the existing AppPreferences.density and is applied as a
// class on <html>. Density and font size both scale the shared
// spacing/type-scale CSS custom properties (tokens.css `--alm-sp-*` /
// `--alm-text-*`) in place via inline overrides on <html> — those tokens are
// consumed by hundreds of component stylesheets already, so this gives an
// app-wide effect through the existing token layer rather than adding
// per-component density/font-size branches (#587).
//
// Persistence (theme-settings-db): the settings DB (`general` scope, `theme`
// / `fontSize` keys — spec 018) is the durable source of truth. localStorage
// (`alm.theme` / `alm.fontSize`) is kept ONLY as a synchronous boot cache so
// `initAppearance()` can paint the right theme/font size before first render
// without waiting on an IPC round-trip. On Windows, WebView2 only flushes its
// localStorage-backing LevelDB store on a graceful shutdown, so a force-killed
// app can lose the cache entirely — the DB survives that.
// `hydrateThemeFromSettings()` reconciles both caches from the DB once IPC is
// available (call after `initAppearance()`); `setThemeChoice` /
// `setFontSizeChoice` write both on every change. Density is not settings-DB
// backed — it stays on the existing `AppPreferences.density` (localStorage)
// path.
import { useSyncExternalStore } from 'react';
import { getPreferences, subscribePreferences } from '@/data/preferences';

export type ThemeId =
  | 'warm-clay'
  | 'warm-slate'
  | 'observatory-dark'
  | 'espresso-dark';
export type ThemeChoice = ThemeId | 'system';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  mode: 'light' | 'dark';
  /** [bg, surface, accent] for swatch previews */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'warm-clay',
    label: 'Warm Clay',
    mode: 'light',
    swatch: ['#f6f4ef', '#efeae1', '#b25a35'],
  },
  {
    id: 'warm-slate',
    label: 'Warm Slate',
    mode: 'light',
    swatch: ['#f5f4f1', '#ecebe6', '#3f6b7a'],
  },
  {
    id: 'observatory-dark',
    label: 'Observatory',
    mode: 'dark',
    swatch: ['#1b1916', '#232019', '#d98a3d'],
  },
  {
    id: 'espresso-dark',
    label: 'Espresso',
    mode: 'dark',
    swatch: ['#161412', '#1e1b18', '#cf9d63'],
  },
];

const THEME_KEY = 'alm.theme';
const LIGHT_DEFAULT: ThemeId = 'warm-slate';
const DARK_DEFAULT: ThemeId = 'observatory-dark';

/** Settings-DB scope/key for the durable theme choice (spec 018 `general` scope). */
const SETTINGS_SCOPE = 'general';
const SETTINGS_KEY = 'theme';

const VALID_CHOICES: readonly ThemeChoice[] = [
  'system',
  ...THEMES.map((t) => t.id),
];

function isThemeChoice(v: unknown): v is ThemeChoice {
  return (
    typeof v === 'string' && (VALID_CHOICES as readonly string[]).includes(v)
  );
}

/**
 * Base pixel values for the shared spacing/type-scale tokens (tokens.css
 * `:root`), duplicated here rather than read via `getComputedStyle` —
 * jsdom (vitest) doesn't reliably resolve stylesheet-declared custom
 * properties through computed style, which would make scaling non-
 * deterministic under test. Keep these in sync with tokens.css if its base
 * `--alm-sp-*` / `--alm-text-*` values ever change — `theme.tokens-drift.test.ts`
 * asserts these tables match the parsed tokens.css `:root` values.
 */
export const SPACING_BASE_PX: Record<string, number> = {
  '--alm-sp-0': 2,
  '--alm-sp-1': 4,
  '--alm-sp-2': 8,
  '--alm-sp-3': 12,
  '--alm-sp-4': 16,
  '--alm-sp-5': 24,
  '--alm-sp-6': 32,
  '--alm-sp-7': 48,
};

/**
 * Text-scale token values (px) at the 14px default root — the same numbers
 * tokens.css encodes as rem (`11/14`, `12/14`, ...). Kept here, rather than
 * only in rem, so `applyFontSize`'s per-token rounding guard (spec 055 T011)
 * has an integer starting point to scale from.
 */
export const TEXT_SCALE_BASE_PX: Record<string, number> = {
  '--alm-text-xs': 11,
  '--alm-text-sm': 12,
  '--alm-text-base': 14,
  '--alm-text-md': 16,
  '--alm-text-lg': 18,
  '--alm-text-xl': 20,
  '--alm-text-2xl': 24,
};

/** Rescales the spacing token table onto <html> inline styles; `scale === 1` clears the override (back to tokens.css defaults). */
function applyTokenScale(base: Record<string, number>, scale: number): void {
  const style = document.documentElement.style;
  for (const [token, px] of Object.entries(base)) {
    if (scale === 1) style.removeProperty(token);
    else style.setProperty(token, `${(px * scale).toFixed(2)}px`);
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeChoice(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Best-effort write-through to the settings DB (spec 018) — same
 * fire-and-forget shape as `syncNativeWindowTheme`: outside Tauri (dev
 * server, vitest) or on any IPC failure this silently no-ops. localStorage
 * is written synchronously by the caller regardless, so the UI never waits
 * on this.
 */
function persistThemeToSettings(choice: ThemeChoice): void {
  void (async () => {
    try {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const [{ commands }, { unwrap }] = await Promise.all([
        import('@/bindings/index'),
        import('@/api/ipc'),
      ]);
      unwrap(
        await commands.settingsUpdate(SETTINGS_SCOPE, {
          [SETTINGS_KEY]: choice,
        }),
      );
    } catch {
      // Best-effort — a DB write failure never blocks or reverts the UI change.
    }
  })();
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* localStorage may be unavailable */
  }
  persistThemeToSettings(choice);
  applyTheme();
  notify();
}

/**
 * Reconcile the synchronous localStorage boot caches (theme + font size)
 * against the settings DB (spec 018) — the DB is the durable source of
 * truth; localStorage only exists to avoid a flash of the wrong value
 * before this async call resolves. Both live in the same `general` scope,
 * so one `settingsGet` round-trip reconciles both. Call once after
 * `initAppearance()` at boot. No-ops outside Tauri or on any IPC failure
 * (the localStorage caches stay authoritative until the next successful
 * reconcile).
 */
export async function hydrateThemeFromSettings(): Promise<void> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    if (!isTauri()) return;

    const [{ commands }, { unwrap }] = await Promise.all([
      import('@/bindings/index'),
      import('@/api/ipc'),
    ]);
    const data = unwrap(await commands.settingsGet(SETTINGS_SCOPE));
    const values = data.values as Record<string, unknown>;

    const storedTheme = values[SETTINGS_KEY];
    if (isThemeChoice(storedTheme) && storedTheme !== getThemeChoice()) {
      setThemeChoice(storedTheme);
    }

    const storedFontSize = values[FONT_SIZE_SETTINGS_KEY];
    if (
      isFontSizeChoice(storedFontSize) &&
      storedFontSize !== getFontSizeChoice()
    ) {
      setFontSizeChoice(storedFontSize);
    }
  } catch {
    // Best-effort — keep the current localStorage-cached choices.
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function resolveTheme(choice: ThemeChoice = getThemeChoice()): ThemeId {
  if (choice === 'system') return prefersDark() ? DARK_DEFAULT : LIGHT_DEFAULT;
  return choice;
}

/**
 * Sync the native window chrome's light/dark family to the resolved theme
 * (spec 051 US6, T037/T038). Gated behind `core.isTauri()` (FR-020: a no-op
 * outside Tauri, e.g. the browser dev server or vitest). Fire-and-forget: a
 * platform/webview that throws or rejects (Linux desktop environments per
 * plan.md's platform-differences table) degrades silently — no error is
 * ever surfaced to the user for a native chrome affordance this minor.
 */
function syncNativeWindowTheme(themeId: ThemeId): void {
  const mode = THEMES.find((t) => t.id === themeId)?.mode ?? 'light';

  void (async () => {
    try {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTheme(mode);
    } catch {
      // Silently degrade (FR-020, US6 AS2) — native chrome theming is
      // best-effort and must never surface an error to the user.
    }
  })();
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme();
  document.documentElement.setAttribute('data-theme', resolved);
  syncNativeWindowTheme(resolved);
}

/** Matches the existing row-height ratio (24/32/40px = -25%/base/+25%). */
const DENSITY_SPACING_SCALE: Record<string, number> = {
  compact: 0.75,
  comfortable: 1,
  spacious: 1.25,
};

/**
 * `--alm-row-height` px per density choice (tokens.css `:root` base + the
 * `.density-compact`/`.density-spacious` overrides) — duplicated here for the
 * same reason as SPACING_BASE_PX/TEXT_SCALE_BASE_PX (jsdom can't reliably
 * resolve stylesheet custom properties). Row-driven virtualizers (e.g.
 * TargetsTable) read this instead of a hardcoded estimate so the initial
 * `estimateSize` tracks the active density; `theme.tokens-drift.test.ts`
 * keeps it in sync with tokens.css.
 */
export const ROW_HEIGHT_PX: Record<string, number> = {
  compact: 24,
  comfortable: 32,
  spacious: 40,
};

export function applyDensity(density?: string): void {
  if (typeof document === 'undefined') return;
  const d = density ?? getPreferences().density;
  const root = document.documentElement.classList;
  root.remove('density-compact', 'density-spacious');
  if (d === 'compact') root.add('density-compact');
  else if (d === 'spacious') root.add('density-spacious');
  applyTokenScale(SPACING_BASE_PX, DENSITY_SPACING_SCALE[d] ?? 1);
}

export type FontSizeChoice = 'small' | 'default' | 'large';

const FONT_SIZE_KEY = 'alm.fontSize';
const FONT_SIZE_SETTINGS_KEY = 'fontSize';

/**
 * Root `<html>` font-size per dial stop (spec 055 FR-002) — three integer
 * px values, replacing the old 0.9/1.0/1.15 fractional multiplier. `default`
 * matches reset.css's `html { font-size: 14px }`, so it is also the value
 * `applyFontSize('default')` clears back to.
 */
const FONT_SIZE_ROOT_PX: Record<FontSizeChoice, number> = {
  small: 12,
  default: 14,
  large: 16,
};

/**
 * Per-token rounding guard (spec 055 T011, plan.md "mandatory, not
 * optional"): tokens.css expresses `--alm-text-*` as rem against the 14px
 * root, so at the 12px/16px stops every token computes fractional
 * (`× 12/14` / `× 16/14`) — e.g. `--alm-text-md` at 16px root is
 * `18.2857...px`. Browsers don't reliably sub-pixel-snap fractional
 * `font-size` the same way across platforms, and spec 055's whole premise is
 * eliminating fractional/sub-floor text, so each token is independently
 * rounded to the nearest integer px and written as an inline override —
 * exactly mirroring the retired `applyTokenScale` px-with-scale approach,
 * but per dial stop instead of a continuous multiplier.
 *
 * At the `default` (14px) stop the ratio is 1, so every rounded value is
 * already the exact TEXT_SCALE_BASE_PX integer (11/12/14/16/18/20/24) — no
 * override needed there; `applyFontSize('default')` clears the props and
 * lets tokens.css's rem values (which resolve to those same integers at the
 * 14px root) take over.
 *
 * The 11px floor (FR-003/SC-003) is guaranteed at `default` only, per the
 * spec's own note: at `small`, the floor token (`--alm-text-xs`) rounds to
 * 9px — a documented, accepted exception, not a bug. Computed values per
 * stop (verified in theme.tokens-drift.test.ts / typography_dial.spec.ts):
 *   small (12px root):   xs=9  sm=10 base=12 md=14 lg=15 xl=17 2xl=21
 *   default (14px root): xs=11 sm=12 base=14 md=16 lg=18 xl=20 2xl=24
 *   large (16px root):   xs=13 sm=14 base=16 md=18 lg=21 xl=23 2xl=27
 *
 * `applyFontSize` writes this rounded table at EVERY stop, including
 * `default` — not only 12px/16px. tokens.css's rem values (e.g.
 * `0.7857rem`) are truncated decimal approximations of repeating fractions
 * (11/14 has no terminating decimal), so at a 14px root they resolve to
 * `10.9998px`, not exactly `11px`. Falling back to the untouched rem tokens
 * at `default` therefore reintroduces fractional computed sizes — the exact
 * defect this rework removes. The inline px override is the only path that
 * is exact at every stop; tokens.css's rem values only matter pre-JS-boot.
 */
function roundedTextScalePx(rootPx: number): Record<string, number> {
  const scale = rootPx / FONT_SIZE_ROOT_PX.default;
  const result: Record<string, number> = {};
  for (const [token, basePx] of Object.entries(TEXT_SCALE_BASE_PX)) {
    result[token] = Math.round(basePx * scale);
  }
  return result;
}

function isFontSizeChoice(v: unknown): v is FontSizeChoice {
  return v === 'small' || v === 'default' || v === 'large';
}

export function getFontSizeChoice(): FontSizeChoice {
  try {
    const v = localStorage.getItem(FONT_SIZE_KEY);
    return isFontSizeChoice(v) ? v : 'default';
  } catch {
    return 'default';
  }
}

/** Best-effort write-through to the settings DB — mirrors `persistThemeToSettings`. */
function persistFontSizeToSettings(choice: FontSizeChoice): void {
  void (async () => {
    try {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const [{ commands }, { unwrap }] = await Promise.all([
        import('@/bindings/index'),
        import('@/api/ipc'),
      ]);
      unwrap(
        await commands.settingsUpdate(SETTINGS_SCOPE, {
          [FONT_SIZE_SETTINGS_KEY]: choice,
        }),
      );
    } catch {
      // Best-effort — a DB write failure never blocks or reverts the UI change.
    }
  })();
}

export function applyFontSize(
  choice: FontSizeChoice = getFontSizeChoice(),
): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  const rootPx = FONT_SIZE_ROOT_PX[choice];

  // Always writes an explicit integer px for every stop, including
  // `default` — see roundedTextScalePx's docstring for why the rem tokens
  // alone can't be trusted to land on an exact integer at any stop.
  style.setProperty('font-size', `${rootPx}px`);
  const rounded = roundedTextScalePx(rootPx);
  for (const [token, px] of Object.entries(rounded)) {
    style.setProperty(token, `${px}px`);
  }
}

export function setFontSizeChoice(choice: FontSizeChoice): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, choice);
  } catch {
    /* localStorage may be unavailable */
  }
  persistFontSizeToSettings(choice);
  applyFontSize(choice);
  notify();
}

/**
 * Call once at startup (before/at first render). Wires OS-theme changes and
 * re-applies density on any preference write, so every density writer
 * (Settings, the Setup wizard's usePreference('density')) gets the token
 * rescale without needing its own applyDensity call (#587).
 */
export function initAppearance(): void {
  applyTheme();
  applyDensity();
  applyFontSize();
  let lastDensity = getPreferences().density;
  subscribePreferences(() => {
    const d = getPreferences().density;
    if (d !== lastDensity) {
      lastDensity = d;
      applyDensity(d);
    }
  });
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      if (getThemeChoice() === 'system') {
        applyTheme();
        notify();
      }
    };
    mq.addEventListener?.('change', onChange);
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Hook: [choice, setChoice]. */
export function useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, getThemeChoice);
  return [choice, setThemeChoice];
}

/** Hook: the resolved (concrete) theme id, tracks OS changes under `system`. */
export function useResolvedTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => resolveTheme());
}

/** Hook: [choice, setChoice] for the app-wide font size. */
export function useFontSizeChoice(): [
  FontSizeChoice,
  (c: FontSizeChoice) => void,
] {
  const choice = useSyncExternalStore(subscribe, getFontSizeChoice);
  return [choice, setFontSizeChoice];
}
