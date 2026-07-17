// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useDetailDock tests — spec 054 T002.
 *
 * Covers: the wide/narrow threshold (Targets 1500 vs the shared 1400
 * default), the pin→bottom fallback when the page can't fit the minimum side
 * width alongside a usable table, and hysteresis (a single-pixel jitter
 * across the threshold must not flip the resolved placement — FR-001/FR-002/
 * FR-003, research.md D1–D3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDetailDock,
  TARGETS_DOCK_THRESHOLD,
  DEFAULT_DOCK_THRESHOLD,
} from './useDetailDock';
import { setDetailDockMode, resetPreferences } from '@/data/preferences';

// A ResizeObserver stub that never fires on its own — these tests drive
// placement via window width + the persisted mode, not the page-width
// measurement (that's exercised by the pin→bottom fallback test below via
// a fixed jsdom element size, which real ResizeObserver would report but the
// stub can't — so that test instead pins the mode and asserts against a
// hand-set `pageWidth` isn't needed: the fallback compares to 0 unless
// observed, so we assert the OPPOSITE — a pin holds 'side' when nothing has
// reported a too-narrow page, and falls to 'bottom' once we simulate a
// too-narrow report).
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  resetPreferences();
  ResizeObserverStub.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDetailDock', () => {
  it('resolves side when window width is at/above the default threshold', () => {
    setWindowWidth(DEFAULT_DOCK_THRESHOLD);
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('sessions', ref));
    expect(result.current.effectivePlacement).toBe('side');
  });

  it('resolves bottom when window width is below the default threshold', () => {
    setWindowWidth(DEFAULT_DOCK_THRESHOLD - 1);
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('sessions', ref));
    expect(result.current.effectivePlacement).toBe('bottom');
  });

  it('uses the higher 1500px threshold for targets specifically', () => {
    setWindowWidth(DEFAULT_DOCK_THRESHOLD); // wide enough for others, not Targets
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('targets', ref));
    expect(result.current.effectivePlacement).toBe('bottom');

    setWindowWidth(TARGETS_DOCK_THRESHOLD);
    const { result: result2 } = renderHook(() => useDetailDock('targets', ref));
    expect(result2.current.effectivePlacement).toBe('side');
  });

  it('does not flip on a 1px jitter across the boundary (hysteresis)', () => {
    setWindowWidth(DEFAULT_DOCK_THRESHOLD - 1);
    const ref = { current: document.createElement('div') };
    // The hook only re-reads `window.innerWidth` on an actual 'resize' event
    // (not on an unrelated re-render), so drive it the same way the browser
    // would: mutate innerWidth, then dispatch 'resize'.
    const { result } = renderHook(() => useDetailDock('sessions', ref));
    expect(result.current.effectivePlacement).toBe('bottom');

    // Cross the raw threshold by exactly 1px — inside the hysteresis band,
    // must NOT flip yet.
    act(() => {
      setWindowWidth(DEFAULT_DOCK_THRESHOLD + 1);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.effectivePlacement).toBe('bottom');

    // Clear the band decisively — now it flips.
    act(() => {
      setWindowWidth(DEFAULT_DOCK_THRESHOLD + 20);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.effectivePlacement).toBe('side');
  });

  it('pinned side falls back to bottom when the page is too narrow for the min side + table floor', () => {
    setWindowWidth(DEFAULT_DOCK_THRESHOLD);
    setDetailDockMode('sessions', 'side');
    const el = document.createElement('div');
    const ref = { current: el };
    const { result } = renderHook(() => useDetailDock('sessions', ref));

    // Report a page width that fits (320 + 640 = 960).
    act(() => {
      ResizeObserverStub.instances[0]?.fire(1000);
    });
    expect(result.current.effectivePlacement).toBe('side');

    // Report a page width too narrow for min-side + table-floor.
    act(() => {
      ResizeObserverStub.instances[0]?.fire(900);
    });
    expect(result.current.effectivePlacement).toBe('bottom');
  });

  it('pinned bottom always resolves bottom regardless of width', () => {
    setWindowWidth(TARGETS_DOCK_THRESHOLD + 100);
    setDetailDockMode('targets', 'bottom');
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('targets', ref));
    expect(result.current.effectivePlacement).toBe('bottom');
  });

  // ── forcedPlacement precedence: forced > user pin > adaptive ──────────────
  // Inbox's permanent split is expressed via this generic mechanism (a future
  // phase passes `forcedPlacement="split"` for the 'inbox' page key) rather
  // than a `page === 'inbox'` special case inside the hook itself.

  it('forcedPlacement wins over an explicit user pin', () => {
    setWindowWidth(200);
    setDetailDockMode('inbox', 'bottom'); // an explicit pin is still overridden
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('inbox', ref, 'split'));
    expect(result.current.effectivePlacement).toBe('split');
  });

  it('forcedPlacement wins over the adaptive heuristic', () => {
    setWindowWidth(TARGETS_DOCK_THRESHOLD + 100); // would otherwise be 'side'
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() =>
      useDetailDock('targets', ref, 'bottom'),
    );
    expect(result.current.effectivePlacement).toBe('bottom');
  });

  it('without a forcedPlacement, resolution falls through to the pin/adaptive chain', () => {
    setWindowWidth(200);
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useDetailDock('sessions', ref));
    expect(result.current.effectivePlacement).toBe('bottom');
  });
});
