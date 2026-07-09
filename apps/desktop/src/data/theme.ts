// Appearance runtime — theme + density (PlateVault redesign).
//
// Theme is applied as a `data-theme` attribute on <html>; tokens.css defines
// one scope per theme. `system` follows the OS via prefers-color-scheme.
// Density mirrors the existing AppPreferences.density and is applied as a
// class on <html>.
//
// Persistence (theme-settings-db): the settings DB (`general` scope, `theme`
// key — spec 018) is the durable source of truth. localStorage (`alm.theme`)
// is kept ONLY as a synchronous boot cache so `initAppearance()` can paint the
// right theme before first render without waiting on an IPC round-trip. On
// Windows, WebView2 only flushes its localStorage-backing LevelDB store on a
// graceful shutdown, so a force-killed app can lose the cache entirely — the
// DB survives that. `hydrateThemeFromSettings()` reconciles the cache from
// the DB once IPC is available (call after `initAppearance()`); `setThemeChoice`
// writes both on every change.
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
 * Reconcile the synchronous localStorage boot cache against the settings DB
 * (spec 018) — the DB is the durable source of truth; localStorage only
 * exists to avoid a flash of the wrong theme before this async call
 * resolves. Call once after `initAppearance()` at boot. No-ops outside
 * Tauri or on any IPC failure (the localStorage cache stays authoritative
 * until the next successful reconcile).
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
    const stored = (data.values as Record<string, unknown>)[SETTINGS_KEY];
    if (isThemeChoice(stored) && stored !== getThemeChoice()) {
      setThemeChoice(stored);
    }
  } catch {
    // Best-effort — keep the current localStorage-cached choice.
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

export function applyDensity(density?: string): void {
  if (typeof document === 'undefined') return;
  const d = density ?? getPreferences().density;
  const root = document.documentElement.classList;
  root.remove('density-compact', 'density-spacious');
  if (d === 'compact') root.add('density-compact');
  else if (d === 'spacious') root.add('density-spacious');
}

/** Call once at startup (before/at first render). Wires OS-theme changes. */
export function initAppearance(): void {
  applyTheme();
  applyDensity();
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
