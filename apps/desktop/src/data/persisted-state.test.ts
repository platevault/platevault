// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * persisted-state.test.ts — unit tests for createPersistedState / hydrateScope.
 *
 * Covers:
 * - set/get/subscribe (in-memory + localStorage synchronous path)
 * - debounced SQLite write (settingsUpdate called after debounce elapses)
 * - hydrateScope reconcile (DB value wins over stale localStorage)
 * - one-time legacy import (DB absent + localStorage present → import to DB)
 * - bootCache:false (localStorage never read or written)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPersistedState,
  hydrateScope,
  __resetScopeRegistryForTest,
} from './persisted-state';

// ── IPC mocks ─────────────────────────────────────────────────────────────────

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

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (scope: string) => settingsGetMock(scope),
    settingsUpdate: (scope: string, values: unknown) =>
      settingsUpdateMock(scope, values),
  },
}));

vi.mock('@/api/ipc', () => ({
  unwrap: (result: IpcOutcome) => {
    if (result.status === 'error') throw result.error;
    return result.data;
  },
}));

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  isTauriMock.mockReset();
  settingsGetMock.mockReset();
  settingsUpdateMock.mockReset();
  settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
  localStorage.clear();
  __resetScopeRegistryForTest();
});

afterEach(() => {
  __resetScopeRegistryForTest();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createPersistedState — set / get / subscribe', () => {
  it('returns the default value before any set()', () => {
    const s = createPersistedState('ui_state', 'uiState.test', { default: 42 });
    expect(s.get()).toBe(42);
  });

  it('set() updates get() immediately', () => {
    const s = createPersistedState('ui_state', 'uiState.test', {
      default: false,
    });
    s.set(true);
    expect(s.get()).toBe(true);
  });

  it('set() notifies subscribers', () => {
    const s = createPersistedState('ui_state', 'uiState.test', {
      default: 0,
    });
    const listener = vi.fn();
    s.subscribe(listener);
    s.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const s = createPersistedState('ui_state', 'uiState.test', {
      default: 0,
    });
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    unsub();
    s.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('set() writes localStorage when bootCache:true (default)', () => {
    const s = createPersistedState('ui_state', 'uiState.test', {
      default: 'hello',
    });
    s.set('world');
    expect(localStorage.getItem('pv.ps.uiState.test')).toBe('"world"');
  });

  it('initialises from localStorage on first get() when a boot cache exists', () => {
    localStorage.setItem('pv.ps.uiState.test', '"cached"');
    const s = createPersistedState('ui_state', 'uiState.test', {
      default: 'default',
    });
    expect(s.get()).toBe('cached');
  });
});

describe('createPersistedState — debounce', () => {
  // These tests use debounceMs:0 so the timer fires immediately and real
  // async/await can settle — vi.useFakeTimers() deadlocks when the debounced
  // handler awaits dynamic imports (vi timer + Promise interaction).

  /** Poll until a mock has been called at least once (max ~200 ms). */
  async function waitForCall(fn: ReturnType<typeof vi.fn>): Promise<void> {
    for (let i = 0; i < 40; i++) {
      if (fn.mock.calls.length > 0) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Wait long enough that a debounceMs:0 timer would have fired if it was going to. */
  async function waitNoCall(): Promise<void> {
    await new Promise((r) => setTimeout(r, 30));
  }

  it('coalesces rapid set() calls — settingsUpdate called once with latest value', async () => {
    isTauriMock.mockReturnValue(true);
    settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });

    const s = createPersistedState('ui_state', 'uiState.debounced', {
      default: 0,
      debounceMs: 0,
    });
    s.set(1);
    s.set(2);
    s.set(3);

    await waitForCall(settingsUpdateMock);

    expect(settingsUpdateMock).toHaveBeenCalledTimes(1);
    expect(settingsUpdateMock).toHaveBeenCalledWith('ui_state', {
      'uiState.debounced': 3,
    });
  });

  it('does not call settingsUpdate outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);

    const s = createPersistedState('ui_state', 'uiState.nontauri', {
      default: 0,
      debounceMs: 0,
    });
    s.set(99);

    await waitNoCall();
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });
});

describe('hydrateScope — reconcile', () => {
  it('updates in-memory value from DB when DB value differs', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: {
        scope: 'ui_state',
        values: { 'uiState.x': 'from-db' },
      },
    });

    const s = createPersistedState('ui_state', 'uiState.x', {
      default: 'default',
    });
    expect(s.get()).toBe('default');

    await hydrateScope('ui_state');

    expect(s.get()).toBe('from-db');
  });

  it('updates localStorage from DB on reconcile', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'ui_state', values: { 'uiState.y': true } },
    });

    const s = createPersistedState('ui_state', 'uiState.y', {
      default: false,
    });
    await hydrateScope('ui_state');

    expect(s.get()).toBe(true);
    expect(localStorage.getItem('pv.ps.uiState.y')).toBe('true');
  });

  it('notifies subscribers when DB value wins', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'ui_state', values: { 'uiState.notify': 'new' } },
    });

    const s = createPersistedState('ui_state', 'uiState.notify', {
      default: 'old',
    });
    const listener = vi.fn();
    s.subscribe(listener);
    await hydrateScope('ui_state');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when DB value equals in-memory value', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'ui_state', values: { 'uiState.same': 'abc' } },
    });

    const s = createPersistedState('ui_state', 'uiState.same', {
      default: 'abc',
    });
    const listener = vi.fn();
    s.subscribe(listener);
    await hydrateScope('ui_state');

    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);

    const s = createPersistedState('ui_state', 'uiState.notauri', {
      default: 'default',
    });
    await hydrateScope('ui_state');

    expect(s.get()).toBe('default');
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  it('keeps current value on IPC failure', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockRejectedValue(new Error('IPC error'));

    const s = createPersistedState('ui_state', 'uiState.fallback', {
      default: 'my-value',
    });
    s.set('set-before-hydrate');
    await hydrateScope('ui_state');

    expect(s.get()).toBe('set-before-hydrate');
  });

  it('batches ONE settingsGet per scope regardless of key count', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: {
        scope: 'ui_state',
        values: { 'uiState.a': 1, 'uiState.b': 2 },
      },
    });

    createPersistedState('ui_state', 'uiState.a', { default: 0 });
    createPersistedState('ui_state', 'uiState.b', { default: 0 });
    await hydrateScope('ui_state');

    expect(settingsGetMock).toHaveBeenCalledTimes(1);
  });
});

describe('hydrateScope — DB key absent', () => {
  it('keeps the boot-cache value when the DB has no row for the key', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'ui_state', values: {} },
    });

    localStorage.setItem('pv.ps.uiState.cached', '"cached-value"');
    const s = createPersistedState('ui_state', 'uiState.cached', {
      default: 'default',
    });
    await hydrateScope('ui_state');

    // Boot-cache read at init time means the value is already 'cached-value'.
    expect(s.get()).toBe('cached-value');
    // No write to DB (nothing to import — greenfield, no legacy).
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });
});

describe('hydrateScope — boot integration', () => {
  // Verifies the sequence main.tsx uses: ensure all scope-registered handles
  // are present BEFORE calling hydrateScope, then DB values reconcile.
  it('reconciles all registered keys from DB in one round-trip', async () => {
    isTauriMock.mockReturnValue(true);
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: {
        scope: 'ui_state',
        values: {
          'uiState.panelOpen': true,
          'uiState.groupDims': ['target', 'filter'],
        },
      },
    });

    const panelState = createPersistedState('ui_state', 'uiState.panelOpen', {
      default: false,
    });
    const groupState = createPersistedState('ui_state', 'uiState.groupDims', {
      default: [] as string[],
    });

    // Before hydrate: defaults.
    expect(panelState.get()).toBe(false);
    expect(groupState.get()).toEqual([]);

    await hydrateScope('ui_state');

    // After hydrate: DB values win.
    expect(panelState.get()).toBe(true);
    expect(groupState.get()).toEqual(['target', 'filter']);
    // Exactly one round-trip regardless of key count.
    expect(settingsGetMock).toHaveBeenCalledTimes(1);
    expect(settingsGetMock).toHaveBeenCalledWith('ui_state');
  });
});

describe('createPersistedState — bootCache:false', () => {
  it('does not read localStorage on init', () => {
    localStorage.setItem('pv.ps.uiState.nocache', '"should-be-ignored"');
    const s = createPersistedState('ui_state', 'uiState.nocache', {
      default: 'default',
      bootCache: false,
    });
    // Should use the default, not the localStorage value.
    expect(s.get()).toBe('default');
  });

  it('does not write localStorage on set()', () => {
    const s = createPersistedState('ui_state', 'uiState.nocache', {
      default: 'default',
      bootCache: false,
    });
    s.set('new-value');
    // No localStorage write should have happened.
    expect(localStorage.getItem('pv.ps.uiState.nocache')).toBeNull();
  });
});
