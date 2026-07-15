// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * theme.density-fontsize.test.ts — #587 (density/font-size have no visible
 * effect). Covers: `applyDensity`/`applyFontSize` scaling the shared
 * `--alm-sp-*` / `--alm-text-*` tokens on <html> (the app-wide effect,
 * verified without depending on any component stylesheet), font-size
 * persistence (localStorage cache + settings-DB write-through, mirroring
 * theme.persistence.test.ts), and `hydrateThemeFromSettings` reconciling
 * both theme and font size from one settings scope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcOutcome =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: unknown };

const isTauriMock = vi.fn<() => boolean>();
const settingsGetMock = vi.fn<(scope: string) => Promise<IpcOutcome>>();
const settingsUpdateMock =
  vi.fn<(scope: string, values: unknown) => Promise<IpcOutcome>>();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (scope: string) => settingsGetMock(scope),
    settingsUpdate: (scope: string, values: unknown) =>
      settingsUpdateMock(scope, values),
  },
}));

async function waitForCall(fn: ReturnType<typeof vi.fn>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.resetModules();
  isTauriMock.mockReset();
  settingsGetMock.mockReset();
  settingsUpdateMock.mockReset();
  settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyDensity — spacing tokens (app-wide, not just row height)', () => {
  it('scales --alm-sp-* down for compact and up for spacious', async () => {
    const { applyDensity } = await import('./theme');
    const style = document.documentElement.style;

    applyDensity('compact');
    expect(style.getPropertyValue('--alm-sp-2')).toBe('6.00px'); // 8 * 0.75
    expect(document.documentElement.classList.contains('density-compact')).toBe(
      true,
    );

    applyDensity('spacious');
    expect(style.getPropertyValue('--alm-sp-2')).toBe('10.00px'); // 8 * 1.25
    expect(
      document.documentElement.classList.contains('density-spacious'),
    ).toBe(true);
    expect(document.documentElement.classList.contains('density-compact')).toBe(
      false,
    );
  });

  it('clears the override for comfortable (falls back to the tokens.css base)', async () => {
    const { applyDensity } = await import('./theme');
    const style = document.documentElement.style;

    applyDensity('compact');
    expect(style.getPropertyValue('--alm-sp-2')).not.toBe('');

    applyDensity('comfortable');
    expect(style.getPropertyValue('--alm-sp-2')).toBe('');
  });
});

describe('applyFontSize — type-scale tokens (app-wide)', () => {
  it('scales --alm-text-* down for small and up for large', async () => {
    const { applyFontSize } = await import('./theme');
    const style = document.documentElement.style;

    applyFontSize('small');
    expect(style.getPropertyValue('--alm-text-base')).toBe('11.70px'); // 13 * 0.9

    applyFontSize('large');
    expect(style.getPropertyValue('--alm-text-base')).toBe('14.95px'); // 13 * 1.15
  });

  it('clears the override for default', async () => {
    const { applyFontSize } = await import('./theme');
    const style = document.documentElement.style;

    applyFontSize('large');
    expect(style.getPropertyValue('--alm-text-base')).not.toBe('');

    applyFontSize('default');
    expect(style.getPropertyValue('--alm-text-base')).toBe('');
  });
});

describe('font size choice — persistence (mirrors the theme choice pattern)', () => {
  it('defaults to "default" with no stored value', async () => {
    const { getFontSizeChoice } = await import('./theme');
    expect(getFontSizeChoice()).toBe('default');
  });

  it('persists to localStorage synchronously and survives a reload (no reset-on-visit)', async () => {
    isTauriMock.mockReturnValue(false);
    const { setFontSizeChoice } = await import('./theme');

    setFontSizeChoice('large');
    expect(localStorage.getItem('alm.fontSize')).toBe('large');

    // Simulate a fresh module load (e.g. a page revisit) reading the cache.
    vi.resetModules();
    const { getFontSizeChoice } = await import('./theme');
    expect(getFontSizeChoice()).toBe('large');
  });

  it('writes through to the settings DB (general scope, fontSize key) when inside Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    const { setFontSizeChoice } = await import('./theme');

    setFontSizeChoice('small');

    await waitForCall(settingsUpdateMock);
    expect(settingsUpdateMock).toHaveBeenCalledWith('general', {
      fontSize: 'small',
    });
  });

  it('skips the settings-DB write outside Tauri (no-op)', async () => {
    isTauriMock.mockReturnValue(false);
    const { setFontSizeChoice } = await import('./theme');

    setFontSizeChoice('small');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });
});

describe('hydrateThemeFromSettings — reconciles font size alongside theme', () => {
  it('applies a stored fontSize from the same settings.get payload', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { fontSize: 'large' } },
    });

    const { hydrateThemeFromSettings, getFontSizeChoice } = await import(
      './theme'
    );
    await hydrateThemeFromSettings();

    expect(getFontSizeChoice()).toBe('large');
    expect(
      document.documentElement.style.getPropertyValue('--alm-text-base'),
    ).toBe('14.95px');
  });

  it('ignores a malformed fontSize value and keeps the current choice', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.fontSize', 'large');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { fontSize: 'huge' } },
    });

    const { hydrateThemeFromSettings, getFontSizeChoice } = await import(
      './theme'
    );
    await hydrateThemeFromSettings();

    expect(getFontSizeChoice()).toBe('large');
  });
});

describe('density preference writes — central rescale via initAppearance()', () => {
  it('a bare setPreference("density") rescales tokens (the Setup wizard path, which never calls applyDensity)', async () => {
    const { initAppearance } = await import('./theme');
    const { setPreference } = await import('./preferences');
    initAppearance();

    // StepCatalogs' DensityControl only writes the preference via
    // usePreference('density') → setPreference; no applyDensity call.
    setPreference('density', 'compact');

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--alm-sp-2')).toBe('6.00px'); // 8 * 0.75
    expect(document.documentElement.classList.contains('density-compact')).toBe(
      true,
    );

    setPreference('density', 'comfortable');
    expect(style.getPropertyValue('--alm-sp-2')).toBe('');
    expect(document.documentElement.classList.contains('density-compact')).toBe(
      false,
    );
  });
});
