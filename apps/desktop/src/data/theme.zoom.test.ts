// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * theme.zoom.test.ts — whole-app engine zoom (spec 055 FR-006, T030).
 *
 * Mirrors theme.persistence.test.ts's mock shape: `getCurrentWebview().setZoom`
 * is the WebView2/WKWebView/WebKitGTK write path (never read back — the app
 * owns the value), persistence mirrors `setThemeChoice`/`setFontSizeChoice`
 * (localStorage boot cache + best-effort settings-DB write-through), and the
 * whole call chain must no-op outside Tauri (browser dev server, vitest,
 * Playwright mock mode) without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcOutcome =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: unknown };

const isTauriMock = vi.fn<() => boolean>();
const settingsGetMock = vi.fn<(scope: string) => Promise<IpcOutcome>>();
const settingsUpdateMock =
  vi.fn<(scope: string, values: unknown) => Promise<IpcOutcome>>();
const setZoomMock = vi.fn<(factor: number) => Promise<void>>();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    setZoom: (factor: number) => setZoomMock(factor),
  }),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (scope: string) => settingsGetMock(scope),
    settingsUpdate: (scope: string, values: unknown) =>
      settingsUpdateMock(scope, values),
  },
}));

/** Poll briefly for an async mock to have been called (mirrors theme.test.ts). */
async function waitForCall(fn: ReturnType<typeof vi.fn>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function resetMocks(): void {
  vi.resetModules();
  isTauriMock.mockReset();
  settingsGetMock.mockReset();
  settingsUpdateMock.mockReset();
  setZoomMock.mockReset();
  settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
  setZoomMock.mockResolvedValue(undefined);
  localStorage.clear();
}

describe('ZOOM_STEPS', () => {
  it('is the spec-mandated 90/100/110/125/150 envelope, default 100', async () => {
    resetMocks();
    const { ZOOM_STEPS, getZoomChoice } = await import('./theme');
    expect(ZOOM_STEPS).toEqual([90, 100, 110, 125, 150]);
    expect(getZoomChoice()).toBe(100);
  });
});

describe('stepZoomIn / stepZoomOut / resetZoom', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('steps up through the envelope and clamps at the top', async () => {
    isTauriMock.mockReturnValue(false);
    const { stepZoomIn, getZoomChoice } = await import('./theme');

    stepZoomIn();
    expect(getZoomChoice()).toBe(110);
    stepZoomIn();
    stepZoomIn();
    expect(getZoomChoice()).toBe(150);
    stepZoomIn(); // already at max — no-op, no throw
    expect(getZoomChoice()).toBe(150);
  });

  it('steps down through the envelope and clamps at the bottom', async () => {
    isTauriMock.mockReturnValue(false);
    const { stepZoomOut, getZoomChoice } = await import('./theme');

    stepZoomOut();
    expect(getZoomChoice()).toBe(90);
    stepZoomOut(); // already at min — no-op
    expect(getZoomChoice()).toBe(90);
  });

  it('resetZoom returns to 100 (Ctrl+0)', async () => {
    isTauriMock.mockReturnValue(false);
    const { stepZoomIn, resetZoom, getZoomChoice } = await import('./theme');

    stepZoomIn();
    stepZoomIn();
    expect(getZoomChoice()).toBe(125);
    resetZoom();
    expect(getZoomChoice()).toBe(100);
  });
});

describe('setZoomChoice — write-through to the settings DB + engine zoom', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('persists to localStorage synchronously and calls settings.update + setZoom inside Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    const { setZoomChoice } = await import('./theme');

    setZoomChoice(125);

    expect(localStorage.getItem('pv.zoom')).toBe('125');
    await waitForCall(settingsUpdateMock);
    expect(settingsUpdateMock).toHaveBeenCalledWith('general', { zoom: 125 });
    await waitForCall(setZoomMock);
    expect(setZoomMock).toHaveBeenCalledWith(1.25);
  });

  it('still persists to localStorage but the engine call and settings.update no-op outside Tauri (mock mode)', async () => {
    isTauriMock.mockReturnValue(false);
    const { setZoomChoice } = await import('./theme');

    expect(() => setZoomChoice(90)).not.toThrow();
    expect(localStorage.getItem('pv.zoom')).toBe('90');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settingsUpdateMock).not.toHaveBeenCalled();
    expect(setZoomMock).not.toHaveBeenCalled();
  });

  it('degrades silently when setZoom rejects (WebView2 has no zoom-change event to reconcile against) — never throws', async () => {
    isTauriMock.mockReturnValue(true);
    setZoomMock.mockRejectedValue(new Error('webview unavailable'));
    const { setZoomChoice } = await import('./theme');

    expect(() => setZoomChoice(150)).not.toThrow();
    await waitForCall(setZoomMock);
    // The persisted choice survives even though the engine-side call failed.
    expect(localStorage.getItem('pv.zoom')).toBe('150');
  });
});

describe('hydrateThemeFromSettings — reconciles zoom from the settings DB too', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('overwrites a stale localStorage cache with the DB zoom value', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('pv.zoom', '90');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { zoom: 125 } },
    });

    const { hydrateThemeFromSettings, getZoomChoice } = await import('./theme');
    await hydrateThemeFromSettings();

    expect(getZoomChoice()).toBe(125);
  });

  it('ignores a malformed/out-of-envelope DB zoom value and keeps the localStorage cache', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('pv.zoom', '110');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { zoom: 999 } },
    });

    const { hydrateThemeFromSettings, getZoomChoice } = await import('./theme');
    await hydrateThemeFromSettings();

    expect(getZoomChoice()).toBe(110);
  });
});

describe('applyZoom — the app owns the write, never reads the engine back', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('initAppearance() applies the persisted zoom at boot alongside theme/density/fontSize', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('pv.zoom', '150');
    const { initAppearance } = await import('./theme');

    initAppearance();

    await waitForCall(setZoomMock);
    expect(setZoomMock).toHaveBeenCalledWith(1.5);
  });
});
