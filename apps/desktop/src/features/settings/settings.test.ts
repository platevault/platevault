/// <reference types="@testing-library/jest-dom" />
/**
 * spec 018 T009 — desktop layer settings tests.
 *
 * Tests the real layer that exists: useAutoSave debounce + updateSettings, and
 * the two new command wrappers settingsRestoreDefaults / settingsSourceOverrideSet.
 *
 * Mock pattern mirrors ResolverSettingsControl.test.tsx: vi.hoisted() + vi.mock().
 * Mocks the generated bindings surface (spec 037) so the real `settingsIpc`
 * wrappers run and their arg-shaping is exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock the generated bindings surface before any module imports it ─────────

const {
  mockUpdateSettings,
  mockSettingsRestoreDefaults,
  mockSettingsSourceOverrideSet,
} = vi.hoisted(() => ({
  mockUpdateSettings: vi.fn(),
  mockSettingsRestoreDefaults: vi.fn(),
  mockSettingsSourceOverrideSet: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsUpdate: mockUpdateSettings,
    settingsRestoreDefaults: mockSettingsRestoreDefaults,
    settingsSourceOverrideSet: mockSettingsSourceOverrideSet,
  },
}));

import { useAutoSave } from './useAutoSave';
import {
  settingsRestoreDefaults,
  settingsSourceOverrideSet,
} from './settingsIpc';

// ── useAutoSave ───────────────────────────────────────────────────────────────

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUpdateSettings.mockResolvedValue({ status: 'ok', data: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUpdateSettings.mockReset();
  });

  it('debounces rapid save calls and calls updateSettings only once per burst', async () => {
    const { result } = renderHook(() => useAutoSave());

    act(() => {
      result.current.save('advanced', { logLevel: 'debug' });
      result.current.save('advanced', { logLevel: 'info' });
      result.current.save('advanced', { logLevel: 'warn' });
    });

    // Before debounce fires: no call yet.
    expect(mockUpdateSettings).not.toHaveBeenCalled();

    // Advance past 300ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(350);
      // Let the async updateSettings promise resolve.
      await Promise.resolve();
    });

    // Only one call — the last value in the burst.
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettings).toHaveBeenCalledWith('advanced', {
      logLevel: 'warn',
    });
  });

  it('does not fire updateSettings before the 300ms window elapses', () => {
    const { result } = renderHook(() => useAutoSave());

    act(() => {
      result.current.save('cleanup', { blockPermanentDelete: true });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('resets saved flag to false after 1.5s feedback window', async () => {
    const { result } = renderHook(() => useAutoSave());

    act(() => {
      result.current.save('advanced', { logLevel: 'debug' });
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(result.current.saved).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(result.current.saved).toBe(false);
  });

  it('passes scope and values to updateSettings with correct shape', async () => {
    const { result } = renderHook(() => useAutoSave());
    const values = { blockPermanentDelete: false, defaultProtection: 'normal' };

    act(() => {
      result.current.save('cleanup', values);
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(mockUpdateSettings).toHaveBeenCalledWith('cleanup', values);
  });
});

// ── settingsRestoreDefaults wrapper ───────────────────────────────────────────

describe('settingsRestoreDefaults', () => {
  beforeEach(() => {
    mockSettingsRestoreDefaults.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'success',
        restored: ['logLevel'],
        alreadyAtDefault: [],
      },
    });
  });

  afterEach(() => {
    mockSettingsRestoreDefaults.mockReset();
  });

  it('calls the generated command with a { keys } object', async () => {
    await settingsRestoreDefaults(['logLevel', 'rememberFollowLogs']);
    expect(mockSettingsRestoreDefaults).toHaveBeenCalledWith({
      keys: ['logLevel', 'rememberFollowLogs'],
    });
  });

  it('passes an empty array to restore all keys', async () => {
    await settingsRestoreDefaults([]);
    expect(mockSettingsRestoreDefaults).toHaveBeenCalledWith({ keys: [] });
  });

  it('returns the RestoreDefaultsResponse from the backend', async () => {
    const result = await settingsRestoreDefaults(['logLevel']);
    expect(result).toEqual({
      status: 'success',
      restored: ['logLevel'],
      alreadyAtDefault: [],
    });
  });
});

// ── settingsSourceOverrideSet wrapper ─────────────────────────────────────────

describe('settingsSourceOverrideSet', () => {
  beforeEach(() => {
    mockSettingsSourceOverrideSet.mockResolvedValue({
      status: 'ok',
      data: {
        sourceId: 'root-uuid-1',
        key: 'hashOnScan',
      },
    });
  });

  afterEach(() => {
    mockSettingsSourceOverrideSet.mockReset();
  });

  it('calls the generated command with camelCase sourceId, key, value', async () => {
    await settingsSourceOverrideSet({
      sourceId: 'root-uuid-1',
      key: 'hashOnScan',
      value: true,
    });
    expect(mockSettingsSourceOverrideSet).toHaveBeenCalledWith({
      sourceId: 'root-uuid-1',
      key: 'hashOnScan',
      value: true,
    });
  });

  it('returns the SetSourceOverrideResponse from the backend', async () => {
    const result = await settingsSourceOverrideSet({
      sourceId: 'root-uuid-1',
      key: 'hashOnScan',
      value: false,
    });
    expect(result).toEqual({ sourceId: 'root-uuid-1', key: 'hashOnScan' });
  });
});
