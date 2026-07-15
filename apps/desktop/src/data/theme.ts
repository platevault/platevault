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
import { getPreferences } from '@/data/preferences';

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
 * `--alm-sp-*` / `--alm-text-*` values ever change.
 */
const SPACING_BASE_PX: Record<string, number> = {
  '--alm-sp-0': 2,
  '--alm-sp-1': 4,
  '--alm-sp-2': 8,
  '--alm-sp-3': 12,
  '--alm-sp-4': 16,
  '--alm-sp-5': 24,
  '--alm-sp-6': 32,
  '--alm-sp-7': 48,
};

const TEXT_SCALE_BASE_PX: Record<string, number> = {
  '--alm-text-2xs': 10,
  '--alm-text-xs': 11,
  '--alm-text-sm': 12,
  '--alm-text-base': 13,
  '--alm-text-md': 14,
  '--alm-text-lg': 16,
  '--alm-text-xl': 18,
  '--alm-text-2xl': 22,
};

/** Rescales a base token table onto <html> inline styles; `scale === 1` clears the override (back to tokens.css defaults). */
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
  return typeof window !== 'undefined' && !!window.matchMedia
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
const FONT_SIZE_SCALE: Record<FontSizeChoice, number> = {
  small: 0.9,
  default: 1,
  large: 1.15,
};

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
  applyTokenScale(TEXT_SCALE_BASE_PX, FONT_SIZE_SCALE[choice]);
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

/** Call once at startup (before/at first render). Wires OS-theme changes. */
export function initAppearance(): void {
  applyTheme();
  applyDensity();
  applyFontSize();
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
