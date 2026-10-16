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
import type { UpdateOffer, UpdateStatus } from '@/bindings/index';

const { mockCommands, mockGetVersion, mockListen } = vi.hoisted(() => ({
  mockCommands: {
    updateStatus: vi.fn(),
    updateOffer: vi.fn(),
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
  getUpdateOfferSnapshot,
  getUpdateSnapshot,
  installUpdateNow,
  installUpdateOnQuit,
  offerHolder,
  startUpdateSubscription,
  stopUpdateSubscription,
  subscribeUpdate,
} from './updateSubscription';
import { resetPreferences, setPreference } from './preferences';

const STATUS_EVENT = 'update:status';
const OFFER_EVENT = 'update:offer';

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { phase: 'idle', version: null, body: null, error: null, ...partial };
}

const NO_OFFER: UpdateOffer = { version: null, channel: 'in-app' };

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data });

/** The handler the subscription registered for STATUS_EVENT. */
let push: ((status: UpdateStatus) => void) | null = null;
/** The handler the subscription registered for OFFER_EVENT. */
let pushOffer: ((offer: UpdateOffer) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  stopUpdateSubscription();
  vi.clearAllMocks();
  delete (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__;
  resetPreferences();
  push = null;
  pushOffer = null;
  mockListen.mockImplementation(
    (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === STATUS_EVENT) push = (payload) => handler({ payload });
      if (event === OFFER_EVENT) pushOffer = (payload) => handler({ payload });
      return Promise.resolve(unlisten);
    },
  );
  mockCommands.updateStatus.mockImplementation(() => ok(status({})));
  mockCommands.updateOffer.mockImplementation(() => ok(NO_OFFER));
  mockCommands.updateCheckOnStartup.mockImplementation(() => ok(null));
  mockCommands.updateCheck.mockImplementation(() => ok(null));
  mockCommands.updateInstallNow.mockImplementation(() => ok(null));
  mockCommands.updateInstallOnQuit.mockImplementation(() => ok(null));
});

afterEach(() => {
  resetPreferences();
});

describe('startUpdateSubscription', () => {
  it('listens before it reads the current status and offer, then asks for the startup check', async () => {
    const order: string[] = [];
    mockListen.mockImplementation((event: string) => {
      order.push(`listen ${event}`);
      return Promise.resolve(unlisten);
    });
    mockCommands.updateStatus.mockImplementation(() => {
      order.push('status');
      return ok(status({ phase: 'available', version: '0.7.0' }));
    });
    mockCommands.updateOffer.mockImplementation(() => {
      order.push('offer');
      return ok<UpdateOffer>({ version: '0.7.0', channel: 'system' });
    });
    mockCommands.updateCheckOnStartup.mockImplementation(() => {
      order.push('startup check');
      return ok(null);
    });

    await startUpdateSubscription();

    expect(order).toEqual([
      `listen ${STATUS_EVENT}`,
      `listen ${OFFER_EVENT}`,
      'status',
      'offer',
      'startup check',
    ]);
    expect(getUpdateSnapshot()).toEqual(
      status({ phase: 'available', version: '0.7.0' }),
    );
    expect(getUpdateOfferSnapshot()).toEqual({
      version: '0.7.0',
      channel: 'system',
    });
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

  it('mirrors every pushed offer and notifies subscribers', async () => {
    await startUpdateSubscription();
    const seen = vi.fn();
    const unsubscribe = subscribeUpdate(seen);

    pushOffer?.({ version: '0.7.0', channel: 'system' });

    expect(getUpdateOfferSnapshot()).toEqual({
      version: '0.7.0',
      channel: 'system',
    });
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('is idempotent', async () => {
    await startUpdateSubscription();
    await startUpdateSubscription();

    // One listener for the status, one for the offer.
    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(mockCommands.updateCheckOnStartup).toHaveBeenCalledTimes(1);
  });

  it('stops listening and returns to idle and no offer when stopped', async () => {
    await startUpdateSubscription();
    push?.(status({ phase: 'available', version: '0.7.0' }));
    pushOffer?.({ version: '0.7.0', channel: 'system' });

    stopUpdateSubscription();

    expect(unlisten).toHaveBeenCalledTimes(2);
    expect(getUpdateSnapshot().phase).toBe('idle');
    expect(getUpdateOfferSnapshot()).toEqual(NO_OFFER);
  });

  it('does not keep the status listener when the offer listener fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockListen
      .mockImplementationOnce(() => Promise.resolve(unlisten))
      .mockImplementationOnce(() => Promise.reject(new Error('no IPC')));

    await startUpdateSubscription();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(mockCommands.updateCheckOnStartup).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // A webview reload reconnects to a running backend; the offer can change
  // while its snapshot is in flight.
  it('keeps an offer event that arrives while the offer snapshot is read', async () => {
    let resolveSnapshot: (offer: UpdateOffer) => void = () => {};
    mockCommands.updateOffer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = (offer) => resolve({ status: 'ok', data: offer });
        }),
    );

    const started = startUpdateSubscription();
    await vi.waitFor(() =>
      expect(mockCommands.updateOffer).toHaveBeenCalledTimes(1),
    );
    // The backend answered with the system offer, then the user closed the
    // notification before the answer reached the webview.
    pushOffer?.({ version: '0.7.0', channel: 'in-app' });
    resolveSnapshot({ version: '0.7.0', channel: 'system' });
    await started;

    expect(getUpdateOfferSnapshot()).toEqual({
      version: '0.7.0',
      channel: 'in-app',
    });
  });

  // React StrictMode runs the effect setup → cleanup → setup while the first
  // start is still waiting for `listen()`.
  it('drops the listener of a start that a stop and a new start overtook', async () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    let resolveFirst: (stop: () => void) => void = () => {};
    mockListen
      .mockImplementationOnce(
        () =>
          new Promise<() => void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(fresh));

    const first = startUpdateSubscription();
    // Let the first start reach `listen()` before the cleanup runs.
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));
    stopUpdateSubscription();
    await startUpdateSubscription();
    resolveFirst(stale);
    await first;

    expect(stale).toHaveBeenCalledTimes(1);
    expect(fresh).not.toHaveBeenCalled();
    expect(mockCommands.updateCheckOnStartup).toHaveBeenCalledTimes(1);

    stopUpdateSubscription();
    expect(fresh).toHaveBeenCalledTimes(1);
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

// astro-plan-c72oo: the in-app notice is the fallback for the system
// notification's offer.
describe('offerHolder', () => {
  const available = status({ phase: 'available', version: '0.7.0' });

  it('is the system notification while it carries this release', () => {
    expect(
      offerHolder(available, { version: '0.7.0', channel: 'system' }),
    ).toBe('system');
  });

  it('is the in-app notice once the backend offered this release in-app', () => {
    expect(
      offerHolder(available, { version: '0.7.0', channel: 'in-app' }),
    ).toBe('in-app');
  });

  it('is undecided while the backend has not offered this release yet', () => {
    expect(offerHolder(available, NO_OFFER)).toBe('deciding');
    expect(
      offerHolder(available, { version: '0.6.9', channel: 'in-app' }),
    ).toBe('deciding');
    expect(
      offerHolder(available, { version: '0.6.9', channel: 'system' }),
    ).toBe('deciding');
  });

  it('is the in-app notice in the phases after a click', () => {
    for (const phase of [
      'downloading',
      'download-failed',
      'installing',
      'install-failed',
      'install-on-quit',
    ] as const) {
      expect(
        offerHolder(status({ phase, version: '0.7.0' }), {
          version: '0.7.0',
          channel: 'system',
        }),
      ).toBe('in-app');
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
    // No backend makes a system offer, so the in-app notice holds it.
    expect(getUpdateOfferSnapshot()).toEqual({
      version: '99.0.0',
      channel: 'in-app',
    });
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
