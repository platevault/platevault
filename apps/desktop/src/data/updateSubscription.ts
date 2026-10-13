// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signed auto-update subscription (spec 051 US10, T058; astro-plan-mkkgi).
 *
 * The updater is frontend-driven and runs on `@tauri-apps/plugin-updater`
 * (real minisign keypair and signing pipeline: spec 051 SC-009/T059/T060,
 * #762). Owner decision 2026-10-12: nothing downloads until the user chooses
 * to install. This supersedes #888's download-first flow, which installed at
 * launch: the plugin's install step runs the Windows installer and exits, and
 * raises a pkexec prompt on deb/rpm.
 *
 * - `checkForUpdate()` only checks. A found update lands on 'available' with
 *   its version and notes; nothing is downloaded, installed or elevated.
 * - `installUpdateNow()` downloads and signature-verifies, installs, then
 *   relaunches. On Windows the install step itself quits into the installer.
 * - `installUpdateOnQuit()` downloads and verifies now, then arms the
 *   backend exit gate (`src-tauri/src/update_exit_gate.rs`). The next quit is
 *   deferred once to this module, which installs and then exits.
 *
 * Failures stay distinct (#873, #869): 'check-failed', 'download-failed',
 * 'install-failed', and 'restart-failed' when the update is installed but the
 * relaunch failed.
 *
 * `startUpdateSubscription()` runs one check at app start. The update notice
 * (`features/update/UpdateBanner.tsx`) and Settings > Advanced subscribe to
 * the resulting state and offer the actions for each phase.
 *
 * In mock/test mode (VITE_USE_MOCKS=true) the Tauri updater/process APIs are
 * unavailable; every exported action is a no-op and the phase stays 'idle'.
 */

import type { Update } from '@tauri-apps/plugin-updater';

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

/** Frontend → backend: payload `true` arms the install-on-quit exit gate,
 * `false` disarms it. Mirrors `update_exit_gate::ARM_EVENT`. */
const ARM_EVENT = 'update:install-on-quit-armed';
/** Backend → main window: the user is quitting with the gate armed. Mirrors
 * `update_exit_gate::INSTALL_EVENT`. */
const INSTALL_EVENT = 'update:install-on-quit';
/** Frontend → backend: the install at quit is over; the exit may proceed.
 * Mirrors `update_exit_gate::FINISHED_EVENT`. */
const FINISHED_EVENT = 'update:install-on-quit-finished';

// E2E test-injection seam: a journey spec can set this before navigation to
// seed a specific update phase without a real Tauri updater host. Only
// consulted in `startUpdateSubscription` before the IS_MOCK guard, so it
// has no effect in production or in unit tests that never set it.
declare global {
  interface Window {
    __PV_TEST__?: {
      updateState?: UpdateState;
    };
  }
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'check-failed'
  /** Found by the check; nothing downloaded yet. */
  | 'available'
  | 'downloading'
  | 'download-failed'
  | 'installing'
  | 'install-failed'
  /** Downloaded and verified; installs when the app quits. */
  | 'install-on-quit'
  /** Installed, but the relaunch failed (#869). */
  | 'restart-failed';

export interface UpdateState {
  phase: UpdatePhase;
  /** Update version, once the check has found one. */
  version?: string;
  body?: string | null;
  /** Present for the '*-failed' phases. */
  error?: string;
}

/** Phases from which the user may choose Install now or Install on quit. */
const INSTALLABLE: ReadonlySet<UpdatePhase> = new Set([
  'available',
  'download-failed',
  'install-failed',
  'install-on-quit',
]);

/** Phases in which a download or install is under way or staged. A re-check
 * would drop the update the user already chose. */
const COMMITTED: ReadonlySet<UpdatePhase> = new Set([
  'downloading',
  'installing',
  'install-on-quit',
  'restart-failed',
]);

/** Whether `state` offers Install now and Install on quit. */
export function canInstall(state: UpdateState): boolean {
  return INSTALLABLE.has(state.phase);
}

type Listener = () => void;

const IDLE_STATE: UpdateState = { phase: 'idle' };

let current: UpdateState = IDLE_STATE;
const listeners = new Set<Listener>();

/** The update found by the last check; holds the verified bytes once
 * `downloaded` is true. */
let pending: Update | null = null;
let downloaded = false;
/** Removes the exit-path listener while the gate is armed. */
let unlistenExit: (() => void) | null = null;

function setState(next: UpdateState): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Extract a display message from a thrown value without pulling in the
 * ContractError catalog (this is a Tauri plugin error, never a backend
 * ContractError). */
function pluginErrMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getUpdateSnapshot(): UpdateState {
  return current;
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let subscribed = false;

/**
 * Check for an update. Never downloads, installs or elevates: a found update
 * only lands on 'available'.
 *
 * Safe to call again from a failed or 'up-to-date' state (the #873 retry
 * affordance). A no-op while an install the user chose is under way or staged.
 */
export async function checkForUpdate(): Promise<void> {
  if (IS_MOCK) return;
  if (COMMITTED.has(current.phase)) return;

  setState({ phase: 'checking' });
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    await releasePending();
    if (!update) {
      setState({ phase: 'up-to-date' });
      return;
    }
    pending = update;
    setState({
      phase: 'available',
      version: update.version,
      body: update.body,
    });
  } catch (err) {
    setState({ phase: 'check-failed', error: pluginErrMessage(err) });
  }
}

/** Download and signature-verify the pending update once; later calls reuse
 * the verified bytes. Returns false on error (state set to 'download-failed')
 * or when a re-check or teardown replaced `update` meanwhile. */
async function ensureDownloaded(update: Update): Promise<boolean> {
  if (downloaded) return true;
  setState({
    phase: 'downloading',
    version: update.version,
    body: update.body,
  });
  try {
    await update.download();
    if (pending !== update) return false;
    downloaded = true;
    return true;
  } catch (err) {
    if (pending !== update) return false;
    setState({
      ...current,
      phase: 'download-failed',
      error: pluginErrMessage(err),
    });
    return false;
  }
}

/**
 * Install now (explicit user action): download and verify, install, then
 * relaunch into the new version. On Windows the install step quits the app
 * into the installer, so the relaunch is never reached there.
 */
export async function installUpdateNow(): Promise<void> {
  if (IS_MOCK) return;
  const update = pending;
  if (!update || !canInstall(current)) return;

  await disarmInstallOnQuit();
  if (!(await ensureDownloaded(update))) return;

  setState({ phase: 'installing', version: update.version, body: update.body });
  try {
    await update.install();
  } catch (err) {
    setState({
      ...current,
      phase: 'install-failed',
      error: pluginErrMessage(err),
    });
    return;
  }
  downloaded = false;
  await relaunchInto();
}

/**
 * Install on quit (explicit user action): download and verify now, then arm
 * the exit gate so the next quit installs. Nothing is installed until then.
 */
export async function installUpdateOnQuit(): Promise<void> {
  if (IS_MOCK) return;
  const update = pending;
  if (!update || !canInstall(current) || current.phase === 'install-on-quit') {
    return;
  }

  if (!(await ensureDownloaded(update))) return;

  try {
    const { listen, emit } = await import('@tauri-apps/api/event');
    unlistenExit ??= await listen(INSTALL_EVENT, () => {
      void installOnExit();
    });
    if (pending !== update) {
      await disarmInstallOnQuit();
      return;
    }
    await emit(ARM_EVENT, true);
  } catch (err) {
    await disarmInstallOnQuit();
    setState({
      ...current,
      phase: 'install-failed',
      error: pluginErrMessage(err),
    });
    return;
  }
  if (pending !== update) {
    await disarmInstallOnQuit();
    return;
  }
  setState({
    phase: 'install-on-quit',
    version: update.version,
    body: update.body,
  });
}

/**
 * The exit path: the backend deferred a quit because the gate was armed.
 * Ask the backend to begin first, and install only when it answers that it
 * now holds the quit: a second quit or its watchdog may already have let the
 * app exit, and an install cut short by that exit could leave no app behind.
 * Then report the install over, and exit. The user asked to quit, so an
 * install failure still exits; the next launch's check offers the update
 * again.
 */
async function installOnExit(): Promise<void> {
  const update = pending;
  unlistenExit?.();
  unlistenExit = null;
  if (update && downloaded && (await beginInstallOnQuit())) {
    setState({
      phase: 'installing',
      version: update.version,
      body: update.body,
    });
    try {
      // The user is quitting: on Windows the installer must not relaunch the
      // app afterwards (tauri-plugin-updater 2.13 relaunches by default).
      await update.install({ restartAfterInstall: false });
      downloaded = false;
    } catch (err) {
      console.warn('[updateSubscription] install on quit failed:', err);
    }
  }
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(FINISHED_EVENT);
  } catch (err) {
    console.warn(
      '[updateSubscription] reporting install finished failed:',
      err,
    );
  }
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
}

/** Whether the backend granted the install at quit; `false` (logged) when
 * it refused or could not be asked. */
async function beginInstallOnQuit(): Promise<boolean> {
  try {
    const [{ commands }, { unwrap }] = await Promise.all([
      import('@/bindings/index'),
      import('@/api/ipc'),
    ]);
    return unwrap(await commands.updateInstallOnQuitBegin());
  } catch (err) {
    console.warn('[updateSubscription] beginning install on quit failed:', err);
    return false;
  }
}

async function relaunchInto(): Promise<void> {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    setState({
      ...current,
      phase: 'restart-failed',
      error: pluginErrMessage(err),
    });
  }
}

/**
 * Retry the relaunch after an install whose relaunch failed. Only valid from
 * 'restart-failed'; a no-op otherwise.
 *
 * The update is already installed on disk, so a `relaunch()` failure never
 * reads as "update failed" (#869): it stays 'restart-failed' with a
 * manual-restart hint.
 */
export async function restartPendingUpdate(): Promise<void> {
  if (IS_MOCK) return;
  if (current.phase !== 'restart-failed') return;
  await relaunchInto();
}

/** Drop the exit-path listener and tell the backend not to defer the quit. */
async function disarmInstallOnQuit(): Promise<void> {
  if (!unlistenExit) return;
  unlistenExit();
  unlistenExit = null;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(ARM_EVENT, false);
  } catch (err) {
    console.warn('[updateSubscription] disarm install on quit failed:', err);
  }
}

/** Free the plugin resource (and any downloaded bytes) of a superseded check. */
async function releasePending(): Promise<void> {
  const previous = pending;
  pending = null;
  downloaded = false;
  try {
    await previous?.close();
  } catch (err) {
    console.warn('[updateSubscription] releasing update failed:', err);
  }
}

/** Start the update-check subscription (idempotent): runs one check now. */
export async function startUpdateSubscription(): Promise<void> {
  if (subscribed) return;
  subscribed = true;
  // E2E override: lets a journey spec seed any update phase before navigation
  // without a real Tauri updater host. Takes effect only when the spec
  // explicitly sets window.__PV_TEST__.updateState via addInitScript.
  if (typeof window !== 'undefined' && window.__PV_TEST__?.updateState) {
    setState(window.__PV_TEST__.updateState);
    return;
  }
  if (IS_MOCK) return;
  await checkForUpdate();
}

/** Reset subscription state so a later `startUpdateSubscription()` re-checks. */
export function stopUpdateSubscription(): void {
  subscribed = false;
  void disarmInstallOnQuit();
  void releasePending();
  setState(IDLE_STATE);
}

/**
 * Running app semver (#845), e.g. "0.5.0". `null` in mock/browser-only dev —
 * there is no Tauri host to ask.
 */
export async function getRunningVersion(): Promise<string | null> {
  if (IS_MOCK) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch (err) {
    console.warn('[updateSubscription] getVersion failed:', err);
    return null;
  }
}
