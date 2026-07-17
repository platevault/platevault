// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * preferences.detailDock tests — spec 054 T003.
 *
 * Covers: set/get round-trips through localStorage, an absent key defaults to
 * `'adaptive'` at the page's default width, a stored width outside
 * `[320, 0.5*window]` is clamped on restore, and Inbox's stored `mode` is
 * preserved (round-trips like any other page) even though the CONSUMER
 * (`useDetailDock`, via `forcedPlacement`) ignores it — see
 * `useDetailDock.test.ts`'s forcedPlacement-precedence coverage.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDetailDock,
  setDetailDockMode,
  setDetailDockWidth,
  resetPreferences,
} from './preferences';

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  resetPreferences();
  setWindowWidth(1600); // generous default so 0.5*window doesn't clamp widths under test
});

afterEach(() => {
  resetPreferences();
});

describe('preferences.detailDock', () => {
  it('defaults an absent key to adaptive at the page default width', () => {
    expect(getDetailDock('sessions')).toEqual({ mode: 'adaptive', width: 420 });
    expect(getDetailDock('inbox')).toEqual({ mode: 'adaptive', width: 360 });
  });

  it('round-trips a mode pin through localStorage', () => {
    setDetailDockMode('targets', 'side');
    expect(getDetailDock('targets').mode).toBe('side');

    // A second read (fresh cache miss simulated via resetPreferences+reload)
    // still finds it — proves it actually persisted, not just in-memory.
    const raw = localStorage.getItem('alm-preferences');
    expect(raw).toContain('"targets":{"mode":"side"');
  });

  it('round-trips a dragged width through localStorage', () => {
    setDetailDockWidth('projects', 500);
    expect(getDetailDock('projects').width).toBe(500);
  });

  it('setting mode preserves a previously-set width, and vice versa', () => {
    setDetailDockWidth('calibration', 480);
    setDetailDockMode('calibration', 'bottom');
    expect(getDetailDock('calibration')).toEqual({
      mode: 'bottom',
      width: 480,
    });

    setDetailDockMode('archive', 'side');
    setDetailDockWidth('archive', 350);
    expect(getDetailDock('archive')).toEqual({ mode: 'side', width: 350 });
  });

  it('clamps a stored width below the 320px minimum on restore', () => {
    setDetailDockWidth('sessions', 100);
    expect(getDetailDock('sessions').width).toBe(320);
  });

  it('clamps a stored width above 50% of the current window on restore', () => {
    setWindowWidth(800); // 50% = 400
    setDetailDockWidth('sessions', 2000);
    expect(getDetailDock('sessions').width).toBe(400);
  });

  it("inbox's stored mode round-trips like any other page (the hook, not the store, ignores it)", () => {
    setDetailDockMode('inbox', 'bottom');
    expect(getDetailDock('inbox').mode).toBe('bottom');
    setDetailDockWidth('inbox', 380);
    expect(getDetailDock('inbox')).toEqual({ mode: 'bottom', width: 380 });
  });
});
