// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * theme.test.ts — spec 051 US6 (T039): native window theme sync.
 *
 * `applyTheme()` now calls `getCurrentWindow().setTheme(mode)` from
 * `@tauri-apps/api/window`, gated behind `core.isTauri()` (FR-020 — a no-op
 * outside Tauri) and wrapped so a throwing/rejecting platform (e.g. Linux
 * desktop environments per plan.md's platform-differences table) degrades
 * silently. Covers: all four themes call `setTheme` with the correct
 * light/dark mode when inside Tauri; nothing is called outside Tauri; a
 * rejecting `setTheme` never throws out of `applyTheme()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn<() => boolean>();
const setThemeMock = vi.fn<(mode: 'light' | 'dark') => Promise<void>>();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTheme: setThemeMock }),
}));

// `applyTheme()` reads localStorage (via getThemeChoice) — reset between
// tests so each case starts from a known theme choice.
function setStoredChoice(choice: string): void {
  localStorage.setItem('alm.theme', choice);
}

/**
 * syncNativeWindowTheme is fire-and-forget and does two dynamic `import()`s
 * before calling `setTheme` — each dynamic import adds its own extra
 * microtask turn beyond a plain `await`, so poll briefly instead of assuming
 * a fixed number of `Promise.resolve()` flushes settle it.
 */
async function waitForCall(fn: ReturnType<typeof vi.fn>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('applyTheme — native window theme sync (spec 051 US6)', () => {
  beforeEach(() => {
    isTauriMock.mockReset();
    setThemeMock.mockReset();
    setThemeMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const CASES: { id: string; mode: 'light' | 'dark' }[] = [
    { id: 'warm-clay', mode: 'light' },
    { id: 'warm-slate', mode: 'light' },
    { id: 'observatory-dark', mode: 'dark' },
    { id: 'espresso-dark', mode: 'dark' },
  ];

  for (const { id, mode } of CASES) {
    it(`calls native setTheme("${mode}") for the ${id} theme when inside Tauri`, async () => {
      isTauriMock.mockReturnValue(true);
      setStoredChoice(id);

      const { applyTheme } = await import('./theme');
      applyTheme();
      await waitForCall(setThemeMock);

      expect(setThemeMock).toHaveBeenCalledWith(mode);
    });
  }

  it('does not call native setTheme outside Tauri (FR-020 no-op)', async () => {
    isTauriMock.mockReturnValue(false);
    setStoredChoice('espresso-dark');

    const { applyTheme } = await import('./theme');
    applyTheme();
    // Negative assertion — give any (incorrect) async call a few turns to
    // show up before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(setThemeMock).not.toHaveBeenCalled();
  });

  it('degrades silently when native setTheme rejects (FR-020, US6 AS2)', async () => {
    isTauriMock.mockReturnValue(true);
    setThemeMock.mockRejectedValue(
      new Error('unsupported on this desktop environment'),
    );
    setStoredChoice('warm-clay');

    const { applyTheme } = await import('./theme');
    expect(() => applyTheme()).not.toThrow();
    await waitForCall(setThemeMock);

    expect(setThemeMock).toHaveBeenCalledWith('light');
  });

  it('still sets the data-theme attribute regardless of native sync outcome', async () => {
    isTauriMock.mockReturnValue(true);
    setThemeMock.mockRejectedValue(new Error('boom'));
    setStoredChoice('observatory-dark');

    const { applyTheme } = await import('./theme');
    applyTheme();
    await waitForCall(setThemeMock);

    expect(document.documentElement.getAttribute('data-theme')).toBe(
      'observatory-dark',
    );
  });
});
