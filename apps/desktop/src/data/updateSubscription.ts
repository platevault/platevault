// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Update status subscription (spec 051 US10; astro-plan-5wcib).
 *
 * The update flow runs in the backend services crate
 * (`crates/desktop/services/src/update`): the check, the download, the
 * minisign verification and the install. This module only mirrors the
 * status the backend pushes as `update:status` events and passes the user's
 * choices to the `update_*` commands. Nothing downloads until the user
 * chooses Install now or Install on quit.
 *
 * - `startUpdateSubscription()` listens first, reads the current status,
 *   then asks for the startup check. The backend runs that check once per
 *   process, and only while "Check for updates automatically" is on
 *   (AppPreferences `checkUpdatesAutomatically`, astro-plan-bzzbp).
 * - `checkForUpdate()` is the manual check; it works with the setting off.
 * - `installUpdateNow()` downloads, verifies, installs and relaunches (on
 *   Windows the app exits into the installer). `installUpdateOnQuit()`
 *   downloads and verifies now; the backend installs when the app quits.
 *
 * In mock/test mode (VITE_USE_MOCKS=true) there is no backend: every action
 * is a no-op and the phase stays 'idle'.
 */

import { type IpcResult, unwrap } from '@/api/ipc';
import {
  commands,
  type UpdatePhase,
  type UpdateStatus,
} from '@/bindings/index';
import { getPreferences } from './preferences';

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

/** Backend → webview status pushes. Mirrors `updater::UPDATE_STATUS_EVENT`. */
const STATUS_EVENT = 'update:status';

// E2E test-injection seam: a journey spec can set this before navigation to
// seed a specific update phase without a backend updater. Only consulted in
// `startUpdateSubscription` before the IS_MOCK guard, so it has no effect in
// production or in unit tests that never set it.
declare global {
  interface Window {
    __PV_TEST__?: {
      updateState?: UpdateState;
    };
  }
}

export type { UpdatePhase };
export type UpdateState = UpdateStatus;

/** Phases from which the user may choose Install now or Install on quit. */
const INSTALLABLE: ReadonlySet<UpdatePhase> = new Set([
  'available',
  'download-failed',
  'install-failed',
  'install-on-quit',
]);

/** Whether `state` offers Install now and Install on quit. */
export function canInstall(state: UpdateState): boolean {
  return INSTALLABLE.has(state.phase);
}

type Listener = () => void;

const IDLE_STATE: UpdateState = {
  phase: 'idle',
  version: null,
  body: null,
  error: null,
};

let current: UpdateState = IDLE_STATE;
const listeners = new Set<Listener>();
let subscribed = false;
let unlisten: (() => void) | null = null;

function setState(next: UpdateState): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getUpdateSnapshot(): UpdateState {
  return current;
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run one update command; its progress arrives as status pushes. */
async function run(
  label: string,
  command: () => Promise<IpcResult<null>>,
): Promise<void> {
  if (IS_MOCK) return;
  try {
    unwrap(await command());
  } catch (err) {
    console.warn(`[updateSubscription] ${label} failed:`, err);
  }
}

/** Check for an update. Never downloads, installs or elevates. */
export async function checkForUpdate(): Promise<void> {
  await run('check', () => commands.updateCheck());
}

/** Install now (explicit user action). */
export async function installUpdateNow(): Promise<void> {
  await run('install now', () => commands.updateInstallNow());
}

/** Install on quit (explicit user action). */
export async function installUpdateOnQuit(): Promise<void> {
  await run('install on quit', () => commands.updateInstallOnQuit());
}

/**
 * Start mirroring the backend's update status (idempotent), then ask for the
 * startup check, which honours "Check for updates automatically".
 */
export async function startUpdateSubscription(): Promise<void> {
  if (subscribed) return;
  subscribed = true;

  if (typeof window !== 'undefined' && window.__PV_TEST__?.updateState) {
    setState(window.__PV_TEST__.updateState);
    return;
  }
  if (IS_MOCK) return;

  try {
    // Listen before reading, so no change between the two is lost.
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen<UpdateState>(STATUS_EVENT, (event) => {
      setState(event.payload);
    });
    if (!subscribed) {
      stop();
      return;
    }
    unlisten = stop;
    setState(unwrap(await commands.updateStatus()));
  } catch (err) {
    console.warn('[updateSubscription] subscribing failed:', err);
    return;
  }
  await run('startup check', () =>
    commands.updateCheckOnStartup(getPreferences().checkUpdatesAutomatically),
  );
}

/** Stop mirroring; a later `startUpdateSubscription()` reads the status again. */
export function stopUpdateSubscription(): void {
  subscribed = false;
  unlisten?.();
  unlisten = null;
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
