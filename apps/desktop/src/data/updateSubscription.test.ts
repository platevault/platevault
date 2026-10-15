// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The update status mirror (astro-plan-5wcib) and running-version display
 * (#845). The update flow itself runs in the backend services crate and is
 * tested there; this suite covers what the webview does: it mirrors the
 * pushed status, sends the user's choices to the `update_*` commands, and
 * passes "Check for updates automatically" to the startup check. `IS_MOCK`
 * is false in the vitest environment (see vitest.config.ts), so the Tauri
 * modules resolve and are mocked here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UpdateStatus } from '@/bindings/index';

const { mockCommands, mockGetVersion, mockListen } = vi.hoisted(() => ({
  mockCommands: {
    updateStatus: vi.fn(),
    updateCheckOnStartup: vi.fn(),
    updateCheck: vi.fn(),
    updateInstallNow: vi.fn(),
    updateInstallOnQuit: vi.fn(),
  },
  mockGetVersion: vi.fn(),
  mockListen: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({ commands: mockCommands }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mockGetVersion }));

import {
  canInstall,
  checkForUpdate,
  getRunningVersion,
  getUpdateSnapshot,
  installUpdateNow,
  installUpdateOnQuit,
  startUpdateSubscription,
  stopUpdateSubscription,
  subscribeUpdate,
} from './updateSubscription';
import { resetPreferences, setPreference } from './preferences';

const STATUS_EVENT = 'update:status';

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { phase: 'idle', version: null, body: null, error: null, ...partial };
}

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data });

/** The handler the subscription registered for STATUS_EVENT. */
let push: ((status: UpdateStatus) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  stopUpdateSubscription();
  vi.clearAllMocks();
  delete (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__;
  resetPreferences();
  push = null;
  mockListen.mockImplementation(
    (event: string, handler: (event: { payload: UpdateStatus }) => void) => {
      if (event === STATUS_EVENT) push = (payload) => handler({ payload });
      return Promise.resolve(unlisten);
    },
  );
  mockCommands.updateStatus.mockImplementation(() => ok(status({})));
  mockCommands.updateCheckOnStartup.mockImplementation(() => ok(null));
  mockCommands.updateCheck.mockImplementation(() => ok(null));
  mockCommands.updateInstallNow.mockImplementation(() => ok(null));
  mockCommands.updateInstallOnQuit.mockImplementation(() => ok(null));
});

afterEach(() => {
  resetPreferences();
});

describe('startUpdateSubscription', () => {
  it('listens before it reads the current status, then asks for the startup check', async () => {
    const order: string[] = [];
    mockListen.mockImplementation(() => {
      order.push('listen');
      return Promise.resolve(unlisten);
    });
    mockCommands.updateStatus.mockImplementation(() => {
      order.push('status');
      return ok(status({ phase: 'available', version: '0.7.0' }));
    });
    mockCommands.updateCheckOnStartup.mockImplementation(() => {
      order.push('startup check');
      return ok(null);
    });

    await startUpdateSubscription();

    expect(order).toEqual(['listen', 'status', 'startup check']);
    expect(getUpdateSnapshot()).toEqual(
      status({ phase: 'available', version: '0.7.0' }),
    );
  });

  it('mirrors every pushed status and notifies subscribers', async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeUpdate(seen);
    await startUpdateSubscription();

    push?.(status({ phase: 'downloading', version: '0.7.0' }));

    expect(getUpdateSnapshot().phase).toBe('downloading');
    expect(seen).toHaveBeenCalled();
    unsubscribe();
  });

  it('is idempotent', async () => {
    await startUpdateSubscription();
    await startUpdateSubscription();

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockCommands.updateCheckOnStartup).toHaveBeenCalledTimes(1);
  });

  it('stops listening and returns to idle when stopped', async () => {
    await startUpdateSubscription();
    push?.(status({ phase: 'available', version: '0.7.0' }));

    stopUpdateSubscription();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(getUpdateSnapshot().phase).toBe('idle');
  });
});

// astro-plan-bzzbp: the backend's startup check runs only while "Check for
// updates automatically" is on; the webview passes the preference along.
describe('startUpdateSubscription — Check for updates automatically', () => {
  it('asks for the startup check with the setting on by default', async () => {
    await startUpdateSubscription();

    expect(mockCommands.updateCheckOnStartup).toHaveBeenCalledWith(true);
  });

  it('tells the backend the setting is off', async () => {
    setPreference('checkUpdatesAutomatically', false);

    await startUpdateSubscription();

    expect(mockCommands.updateCheckOnStartup).toHaveBeenCalledWith(false);
    expect(mockCommands.updateCheck).not.toHaveBeenCalled();
  });

  it('still checks when the user asks while it is off', async () => {
    setPreference('checkUpdatesAutomatically', false);
    await startUpdateSubscription();

    await checkForUpdate();

    expect(mockCommands.updateCheck).toHaveBeenCalledTimes(1);
  });
});

describe('the user choices', () => {
  it('Install now and Install on quit each run their own command', async () => {
    await installUpdateNow();
    expect(mockCommands.updateInstallNow).toHaveBeenCalledTimes(1);
    expect(mockCommands.updateInstallOnQuit).not.toHaveBeenCalled();

    await installUpdateOnQuit();
    expect(mockCommands.updateInstallOnQuit).toHaveBeenCalledTimes(1);
  });

  it('a failed command is logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCommands.updateCheck.mockImplementation(() =>
      Promise.resolve({
        status: 'error' as const,
        error: {
          code: 'internal_error',
          message: 'updates are unavailable in this build',
        },
      }),
    );

    await expect(checkForUpdate()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('offers the install choices only from installable phases', () => {
    for (const phase of [
      'available',
      'download-failed',
      'install-failed',
      'install-on-quit',
    ] as const) {
      expect(canInstall(status({ phase }))).toBe(true);
    }
    for (const phase of [
      'idle',
      'checking',
      'up-to-date',
      'check-failed',
      'downloading',
      'installing',
    ] as const) {
      expect(canInstall(status({ phase }))).toBe(false);
    }
  });
});

describe('startUpdateSubscription — __PV_TEST__ override', () => {
  it('seeds state from window.__PV_TEST__.updateState without the backend', async () => {
    const seeded = status({ phase: 'available', version: '99.0.0' });
    (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__ = {
      updateState: seeded,
    };

    await startUpdateSubscription();

    expect(getUpdateSnapshot()).toEqual(seeded);
    expect(mockListen).not.toHaveBeenCalled();
    expect(mockCommands.updateCheckOnStartup).not.toHaveBeenCalled();
  });
});

describe('getRunningVersion', () => {
  it('returns the version reported by the Tauri app API', async () => {
    mockGetVersion.mockResolvedValue('0.5.0');

    await expect(getRunningVersion()).resolves.toBe('0.5.0');
  });

  it('returns null when the API call fails', async () => {
    mockGetVersion.mockRejectedValue(new Error('unavailable'));

    await expect(getRunningVersion()).resolves.toBeNull();
  });
});
