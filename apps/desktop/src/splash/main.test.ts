// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * splash/main.test.ts — event-driven splash dismissal (handoff 07).
 *
 * Verifies:
 * - boot-ready triggers immediate dismissal (no minimum floor).
 * - The fallback timer fires after READY_TIMEOUT_MS when boot-ready never
 *   arrives (unchanged from the original design).
 * - Timestamps are logged at splash-shown, boot-ready-received, and
 *   window-shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Tauri API mocks ---

const mockShow = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSetFocus = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

let bootReadyCallback: (() => void) | null = null;

vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn(() =>
    Promise.resolve([
      { label: 'main', show: mockShow, setFocus: mockSetFocus },
    ]),
  ),
  getCurrentWindow: vi.fn(() => ({
    close: mockClose,
  })),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, cb: () => void) => {
    bootReadyCallback = cb;
    return Promise.resolve(() => {});
  }),
}));

// --- DOM stub ---

// splash/main.ts reads #pv-version and .pv-card on module load / at
// closeSplashAndShowMain call time. Provide minimal stubs.
function setupDom() {
  document.body.innerHTML = `
    <div class="pv-card"></div>
    <span id="pv-version"></span>
  `;
}

// --- Helpers ---

/** Fire the boot-ready event registered by the module. */
function fireBootReady() {
  if (!bootReadyCallback)
    throw new Error('listen() never called — module not loaded');
  bootReadyCallback();
}

describe('splash main — event-driven dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockShow.mockClear();
    mockSetFocus.mockClear();
    mockClose.mockClear();
    bootReadyCallback = null;
    setupDom();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('dismisses immediately on boot-ready without any floor wait', async () => {
    // Load module — registers the listener.
    await import('./main');

    // Confirm listener was registered.
    expect(bootReadyCallback).not.toBeNull();

    // Fire boot-ready just after module load (simulates warm start where
    // boot-ready arrives before any minimum floor would have elapsed).
    fireBootReady();

    // Advance only the FADE_MS (150 ms) — no 800 ms wait should exist.
    await vi.advanceTimersByTimeAsync(150);

    // main window must be shown and splash closed.
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT show main or close before the fade completes', async () => {
    await import('./main');
    fireBootReady();

    // Advance only half the fade.
    await vi.advanceTimersByTimeAsync(74);

    expect(mockShow).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('fallback timer fires after READY_TIMEOUT_MS when boot-ready never arrives', async () => {
    const { READY_TIMEOUT_MS, FADE_MS } = await import('./main');

    // Advance until main window is detected by the poll loop.
    await vi.advanceTimersByTimeAsync(250);

    // Advance past the fallback timeout + fade.
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + FADE_MS);

    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a second boot-ready after the first closes the splash', async () => {
    await import('./main');

    fireBootReady();
    await vi.advanceTimersByTimeAsync(150);

    // Reset call counts, then fire again.
    mockShow.mockClear();
    mockClose.mockClear();
    fireBootReady();
    await vi.advanceTimersByTimeAsync(150);

    expect(mockClose).not.toHaveBeenCalled();
  });

  it('logs splash-shown, boot-ready-received, and window-shown timestamps', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await import('./main');
    fireBootReady();
    await vi.advanceTimersByTimeAsync(150);

    const labels = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(labels.some((l) => l.includes('splash-shown'))).toBe(true);
    expect(labels.some((l) => l.includes('boot-ready-received'))).toBe(true);
    expect(labels.some((l) => l.includes('window-shown'))).toBe(true);

    consoleSpy.mockRestore();
  });
});
