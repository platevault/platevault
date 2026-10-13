// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Install-on-choice update flow (astro-plan-mkkgi, keeps #869/#873) and
 * running-version display (#845). Exercises the frontend-driven
 * check / download / install state machine against mocked
 * `@tauri-apps/plugin-updater`, `plugin-process`, `api/event` and `api/app`
 * modules — `IS_MOCK` is false in the vitest environment (see
 * vitest.config.ts), so these dynamic imports resolve and must be mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockCheck,
  mockRelaunch,
  mockExit,
  mockGetVersion,
  mockListen,
  mockEmit,
  mockBegin,
} = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockRelaunch: vi.fn(),
  mockExit: vi.fn(),
  mockGetVersion: vi.fn(),
  mockListen: vi.fn(),
  mockEmit: vi.fn(),
  mockBegin: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
  exit: mockExit,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
  emit: mockEmit,
}));
vi.mock('@/bindings/index', () => ({
  commands: { updateInstallOnQuitBegin: mockBegin },
}));
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}));

import {
  checkForUpdate,
  installUpdateNow,
  installUpdateOnQuit,
  restartPendingUpdate,
  startUpdateSubscription,
  stopUpdateSubscription,
  getUpdateSnapshot,
  getRunningVersion,
} from './updateSubscription';
import { resetPreferences, setPreference } from './preferences';

const ARM_EVENT = 'update:install-on-quit-armed';
const INSTALL_EVENT = 'update:install-on-quit';
const BEGIN = 'begin';
const FINISHED = 'emit:update:install-on-quit-finished:undefined';

/** Records the order of every updater/process side effect. */
let calls: string[] = [];
/** The exit-path handler registered for INSTALL_EVENT, once armed. */
let exitHandler: (() => void) | null = null;
const unlisten = vi.fn();

/** A resolved side effect that records `name` in `calls`. */
function recorder(name: string) {
  return () => {
    calls.push(name);
    return Promise.resolve();
  };
}

function makeUpdate() {
  return {
    version: '0.6.0',
    body: 'Release notes',
    download: vi.fn(recorder('download')),
    install: vi.fn(recorder('install')),
    downloadAndInstall: vi.fn(recorder('downloadAndInstall')),
    close: vi.fn(() => Promise.resolve()),
  };
}

/** Run the check with `update` available, landing on 'available'. */
async function checkFinds(update: ReturnType<typeof makeUpdate>) {
  mockCheck.mockResolvedValue(update);
  await checkForUpdate();
}

/** Let fire-and-forget work (the exit handler, teardown's disarm) finish. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Fire the backend's install-on-quit event and wait for the exit path to
 * reach `exit()`; it loads host modules lazily, so it spans several ticks. */
async function quitThroughGate() {
  exitHandler?.();
  await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0));
}

beforeEach(async () => {
  stopUpdateSubscription();
  await settle();
  vi.clearAllMocks();
  calls = [];
  exitHandler = null;
  mockListen.mockImplementation((event: string, handler: () => void) => {
    if (event === INSTALL_EVENT) exitHandler = handler;
    return Promise.resolve(unlisten);
  });
  mockEmit.mockImplementation((event: string, payload: unknown) =>
    recorder(`emit:${event}:${String(payload)}`)(),
  );
  mockRelaunch.mockImplementation(recorder('relaunch'));
  mockExit.mockImplementation(recorder('exit'));
  mockBegin.mockImplementation(() => {
    calls.push(BEGIN);
    return Promise.resolve({ status: 'ok', data: true });
  });
});

describe('checkForUpdate', () => {
  it('sets up-to-date when no update is available', async () => {
    mockCheck.mockResolvedValue(null);

    await checkForUpdate();

    expect(getUpdateSnapshot()).toEqual({ phase: 'up-to-date' });
  });

  it('a check alone never downloads, installs or relaunches', async () => {
    const update = makeUpdate();

    await checkFinds(update);

    expect(calls).toEqual([]);
    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(getUpdateSnapshot()).toEqual({
      phase: 'available',
      version: '0.6.0',
      body: 'Release notes',
    });
  });

  it('sets check-failed (not up-to-date) when the check itself rejects (#873)', async () => {
    mockCheck.mockRejectedValue(new Error('network unreachable'));

    await checkForUpdate();

    const snapshot = getUpdateSnapshot();
    expect(snapshot.phase).toBe('check-failed');
    expect(snapshot.error).toBe('network unreachable');
  });

  it('frees the superseded update when a re-check replaces it', async () => {
    const first = makeUpdate();
    await checkFinds(first);

    await checkFinds(makeUpdate());

    expect(first.close).toHaveBeenCalledTimes(1);
  });
});

describe('installUpdateNow', () => {
  it('downloads, then installs, then relaunches', async () => {
    const update = makeUpdate();
    await checkFinds(update);

    await installUpdateNow();

    expect(calls).toEqual(['download', 'install', 'relaunch']);
    // Install now keeps the plugin default: Windows relaunches after install.
    expect(update.install).toHaveBeenCalledWith();
  });

  it('is a no-op before a check has found an update', async () => {
    mockCheck.mockResolvedValue(null);
    await checkForUpdate();

    await installUpdateNow();

    expect(calls).toEqual([]);
  });

  it('sets download-failed and never installs when the download or verification fails', async () => {
    const update = makeUpdate();
    update.download.mockRejectedValueOnce(new Error('signature mismatch'));
    await checkFinds(update);

    await installUpdateNow();

    expect(update.install).not.toHaveBeenCalled();
    expect(getUpdateSnapshot()).toMatchObject({
      phase: 'download-failed',
      error: 'signature mismatch',
      version: '0.6.0',
    });
  });

  it('sets install-failed and does not relaunch when the install fails', async () => {
    const update = makeUpdate();
    update.install.mockRejectedValueOnce(new Error('installer failed'));
    await checkFinds(update);

    await installUpdateNow();

    expect(mockRelaunch).not.toHaveBeenCalled();
    expect(getUpdateSnapshot()).toMatchObject({
      phase: 'install-failed',
      error: 'installer failed',
    });
  });

  it('retries from download-failed by downloading again', async () => {
    const update = makeUpdate();
    update.download.mockRejectedValueOnce(new Error('disk full'));
    await checkFinds(update);
    await installUpdateNow(); // -> download-failed

    await installUpdateNow();

    expect(calls).toEqual(['download', 'install', 'relaunch']);
  });
});

describe('installUpdateOnQuit', () => {
  it('downloads and arms the exit gate, but installs only from the exit path', async () => {
    const update = makeUpdate();
    await checkFinds(update);

    await installUpdateOnQuit();

    expect(calls).toEqual(['download', `emit:${ARM_EVENT}:true`]);
    expect(getUpdateSnapshot()).toMatchObject({
      phase: 'install-on-quit',
      version: '0.6.0',
    });
    expect(exitHandler).not.toBeNull();

    // The backend deferred the user's quit: ask to begin, install, report the
    // install over, then exit.
    await quitThroughGate();

    expect(calls).toEqual([
      'download',
      `emit:${ARM_EVENT}:true`,
      BEGIN,
      'install',
      FINISHED,
      'exit',
    ]);
    expect(mockRelaunch).not.toHaveBeenCalled();
    // The user is quitting: the Windows installer must not relaunch the app.
    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: false });
  });

  it('still exits when the install on quit fails', async () => {
    const update = makeUpdate();
    update.install.mockRejectedValueOnce(new Error('pkexec dismissed'));
    await checkFinds(update);
    await installUpdateOnQuit();

    await quitThroughGate();

    expect(calls.slice(-2)).toEqual([FINISHED, 'exit']);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('never installs on quit when the backend refuses the begin', async () => {
    // A second quit or the watchdog already released the gate.
    const update = makeUpdate();
    await checkFinds(update);
    await installUpdateOnQuit();
    mockBegin.mockResolvedValueOnce({ status: 'ok', data: false });

    await quitThroughGate();

    expect(update.install).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('never installs on quit when the begin cannot be asked', async () => {
    const update = makeUpdate();
    await checkFinds(update);
    await installUpdateOnQuit();
    mockBegin.mockRejectedValueOnce(new Error('ipc down'));

    await quitThroughGate();

    expect(update.install).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('drops a download superseded by teardown instead of arming the gate', async () => {
    const update = makeUpdate();
    let finishDownload: () => void = () => {};
    update.download.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = () => {
            calls.push('download');
            resolve();
          };
        }),
    );
    await checkFinds(update);

    const choosing = installUpdateOnQuit();
    await settle();
    stopUpdateSubscription(); // e.g. the Shell unmounts mid-download
    finishDownload();
    await choosing;
    await settle();

    expect(calls).toEqual(['download']);
    expect(mockEmit).not.toHaveBeenCalledWith(ARM_EVENT, true);
    expect(getUpdateSnapshot().phase).toBe('idle');
  });

  it('does not arm the gate when the download fails', async () => {
    const update = makeUpdate();
    update.download.mockRejectedValueOnce(new Error('offline'));
    await checkFinds(update);

    await installUpdateOnQuit();

    expect(mockEmit).not.toHaveBeenCalled();
    expect(getUpdateSnapshot().phase).toBe('download-failed');
  });

  it('Install now from install-on-quit disarms, reuses the download and installs', async () => {
    await checkFinds(makeUpdate());
    await installUpdateOnQuit();

    await installUpdateNow();

    expect(calls).toEqual([
      'download',
      `emit:${ARM_EVENT}:true`,
      `emit:${ARM_EVENT}:false`,
      'install',
      'relaunch',
    ]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('a re-check while install-on-quit is staged keeps the staged update', async () => {
    await checkFinds(makeUpdate());
    await installUpdateOnQuit();
    mockCheck.mockClear();

    await checkForUpdate();

    expect(mockCheck).not.toHaveBeenCalled();
    expect(getUpdateSnapshot().phase).toBe('install-on-quit');
  });
});

describe('restartPendingUpdate', () => {
  it('is a no-op outside restart-failed', async () => {
    await checkFinds(makeUpdate()); // -> available

    await restartPendingUpdate();

    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it('sets restart-failed (not a failure banner) when relaunch fails after a successful install (#869)', async () => {
    await checkFinds(makeUpdate());
    mockRelaunch.mockRejectedValueOnce(new Error('relaunch denied'));

    await installUpdateNow();

    const snapshot = getUpdateSnapshot();
    expect(snapshot.phase).toBe('restart-failed');
    expect(snapshot.error).toBe('relaunch denied');
    // The version stays visible — the point of #869 is that it IS installed.
    expect(snapshot.version).toBe('0.6.0');
  });

  it('retrying restart from restart-failed relaunches without reinstalling', async () => {
    const update = makeUpdate();
    await checkFinds(update);
    mockRelaunch.mockRejectedValueOnce(new Error('relaunch denied'));
    await installUpdateNow(); // -> restart-failed

    await restartPendingUpdate();

    expect(mockRelaunch).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledTimes(1);
  });
});

describe('startUpdateSubscription — __PV_TEST__ override', () => {
  beforeEach(() => {
    delete (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__;
  });

  it('seeds state from window.__PV_TEST__.updateState, skipping the real check', async () => {
    (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__ = {
      updateState: { phase: 'available', version: '99.0.0' },
    };

    await startUpdateSubscription();

    expect(getUpdateSnapshot()).toEqual({
      phase: 'available',
      version: '99.0.0',
    });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call with the hook set does not re-seed', async () => {
    (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__ = {
      updateState: { phase: 'up-to-date' },
    };

    await startUpdateSubscription();
    // Mutate the hook after first call — should have no effect.
    (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__ = {
      updateState: { phase: 'check-failed', error: 'should not appear' },
    };
    await startUpdateSubscription();

    expect(getUpdateSnapshot()).toEqual({ phase: 'up-to-date' });
  });

  it('runs one check-only pass when the hook is absent', async () => {
    const update = makeUpdate();
    mockCheck.mockResolvedValue(update);

    await startUpdateSubscription();

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(getUpdateSnapshot().phase).toBe('available');
  });
});

// astro-plan-bzzbp: Shell's mount effect calls startUpdateSubscription(); the
// "Check for updates automatically" preference decides whether it contacts
// the updater endpoint. The real preferences store runs on jsdom localStorage.
describe('startUpdateSubscription — Check for updates automatically', () => {
  beforeEach(() => {
    delete (window as Window & { __PV_TEST__?: unknown }).__PV_TEST__;
    resetPreferences();
  });
  afterEach(() => {
    resetPreferences();
  });

  it('is on by default and runs the startup check once', async () => {
    mockCheck.mockResolvedValue(null);

    await startUpdateSubscription();
    await startUpdateSubscription();

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(getUpdateSnapshot()).toEqual({ phase: 'up-to-date' });
  });

  it('runs no check at startup when turned off', async () => {
    setPreference('checkUpdatesAutomatically', false);

    await startUpdateSubscription();

    expect(mockCheck).not.toHaveBeenCalled();
    expect(getUpdateSnapshot()).toEqual({ phase: 'idle' });
  });

  it('still checks when the user asks while it is off', async () => {
    setPreference('checkUpdatesAutomatically', false);
    await startUpdateSubscription();
    mockCheck.mockResolvedValue(makeUpdate());

    await checkForUpdate();

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(getUpdateSnapshot().phase).toBe('available');
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
