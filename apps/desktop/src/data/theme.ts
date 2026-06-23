// Appearance runtime — theme + density (PlateVault redesign).
//
// Theme is persisted in localStorage under `alm.theme` and applied as a
// `data-theme` attribute on <html>; tokens.css defines one scope per theme.
// `system` follows the OS via prefers-color-scheme. Density mirrors the
// existing AppPreferences.density and is applied as a class on <html>.
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
  { id: 'warm-clay', label: 'Warm Clay', mode: 'light', swatch: ['#f6f4ef', '#efeae1', '#b25a35'] },
  { id: 'warm-slate', label: 'Warm Slate', mode: 'light', swatch: ['#f5f4f1', '#ecebe6', '#3f6b7a'] },
  { id: 'observatory-dark', label: 'Observatory', mode: 'dark', swatch: ['#1b1916', '#232019', '#d98a3d'] },
  { id: 'espresso-dark', label: 'Espresso', mode: 'dark', swatch: ['#161412', '#1e1b18', '#cf9d63'] },
];

const THEME_KEY = 'alm.theme';
const LIGHT_DEFAULT: ThemeId = 'warm-slate';
const DARK_DEFAULT: ThemeId = 'observatory-dark';

const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY) as ThemeChoice | null;
    return v ?? 'system';
  } catch {
    return 'system';
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* localStorage may be unavailable */
  }
  applyTheme();
  notify();
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

export function applyTheme(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme());
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
