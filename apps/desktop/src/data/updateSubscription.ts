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
 * It also mirrors where the backend offered a found release
 * (`update:offer` events, astro-plan-c72oo): while the system notification
 * carries Install now and Install on quit, or the backend is still deciding
 * whether it can, the in-app notice leaves the `available` phase to it
 * (`offerHolder`).
 *
 * - `startUpdateSubscription()` listens first, reads the current status and
 *   offer, then asks for the startup check. The backend runs that check once
 *   per process, and only while "Check for updates automatically" is on
 *   (AppPreferences `checkUpdatesAutomatically`, astro-plan-bzzbp).
 * - `checkForUpdate()` is the manual check; it works with the setting off.
 * - `installUpdateNow()` downloads, verifies, installs and relaunches (on
 *   Windows the app exits into the installer). `installUpdateOnQuit()`
 *   downloads and verifies now; the backend installs when the app quits.
 *
 * In mock/test mode (VITE_USE_MOCKS=true) there is no backend: every action
 * is a no-op, the phase stays 'idle' and the offer stays in-app.
 */

import { type IpcResult, unwrap } from '@/api/ipc';
import {
  commands,
  type UpdateOffer,
  type UpdatePhase,
  type UpdateStatus,
} from '@/bindings/index';
import { getPreferences } from './preferences';

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

/** Backend → webview status pushes. Mirrors `updater::UPDATE_STATUS_EVENT`. */
const STATUS_EVENT = 'update:status';

/** Backend → webview offer pushes. Mirrors `updater::UPDATE_OFFER_EVENT`. */
const OFFER_EVENT = 'update:offer';

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

export type { UpdateOffer, UpdatePhase };
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

/**
 * Who offers Install now and Install on quit for `state`'s release:
 * - `system`: the system notification carries both buttons;
 * - `in-app`: the in-app notice does, because the backend could not offer the
 *   release in a notification, the notification was answered, closed or
 *   withdrawn, or the phase is past the offer;
 * - `deciding`: the backend has not yet decided for this release. It does so
 *   once the system post is accepted, refused or timed out, so the in-app
 *   choices wait for that.
 */
export type OfferHolder = 'system' | 'in-app' | 'deciding';

export function offerHolder(
  state: UpdateState,
  offer: UpdateOffer,
): OfferHolder {
  if (state.phase !== 'available') return 'in-app';
  if (offer.version !== state.version) return 'deciding';
  return offer.channel === 'system' ? 'system' : 'in-app';
}

type Listener = () => void;

const IDLE_STATE: UpdateState = {
  phase: 'idle',
  version: null,
  body: null,
  error: null,
};

const NO_OFFER: UpdateOffer = { version: null, channel: 'in-app' };

let current: UpdateState = IDLE_STATE;
let currentOffer: UpdateOffer = NO_OFFER;
const listeners = new Set<Listener>();
let subscribed = false;
/**
 * Bumped by every start and stop. A start that resumes after a later start
 * or a stop (React StrictMode runs setup → cleanup → setup) sees its token
 * is stale and removes its own listeners instead of keeping them.
 */
let generation = 0;
let unlisten: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function setState(next: UpdateState): void {
  current = next;
  notify();
}

function setOffer(next: UpdateOffer): void {
  currentOffer = next;
  notify();
}

export function getUpdateSnapshot(): UpdateState {
  return current;
}

/** Where the backend offered the release the last check found. */
export function getUpdateOfferSnapshot(): UpdateOffer {
  return currentOffer;
}

/** Called on every status and offer change. */
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
 * Start mirroring the backend's update status and offer (idempotent), then
 * ask for the startup check, which honours "Check for updates automatically".
 */
export async function startUpdateSubscription(): Promise<void> {
  if (subscribed) return;
  subscribed = true;
  const token = ++generation;

  if (typeof window !== 'undefined' && window.__PV_TEST__?.updateState) {
    const seeded = window.__PV_TEST__.updateState;
    setState(seeded);
    // No backend makes a system offer, so the in-app notice holds it.
    setOffer({ version: seeded.version, channel: 'in-app' });
    return;
  }
  if (IS_MOCK) return;

  const stops: Array<() => void> = [];
  const stop = () => {
    for (const stopOne of stops.splice(0)) stopOne();
  };
  try {
    // Listen before reading, so no change between the two is lost.
    const { listen } = await import('@tauri-apps/api/event');
    stops.push(
      await listen<UpdateState>(STATUS_EVENT, (event) => {
        setState(event.payload);
      }),
    );
    // Set by an offer event, so an offer snapshot read before the event
    // does not replace it.
    let offerPushed = false;
    if (token === generation) {
      stops.push(
        await listen<UpdateOffer>(OFFER_EVENT, (event) => {
          offerPushed = true;
          setOffer(event.payload);
        }),
      );
    }
    if (token !== generation) {
      stop();
      return;
    }
    unlisten = stop;
    const status = unwrap(await commands.updateStatus());
    const offer = unwrap(await commands.updateOffer());
    if (token !== generation) return;
    setState(status);
    if (!offerPushed) setOffer(offer);
  } catch (err) {
    // A listener whose sibling failed to register is not kept half-wired.
    if (unlisten !== stop) stop();
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
  generation += 1;
  unlisten?.();
  unlisten = null;
  currentOffer = NO_OFFER;
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
