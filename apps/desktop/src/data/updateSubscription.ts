/**
 * Signed auto-update subscription (spec 051 US10, T058).
 *
 * Listens for the backend's `update-available` Tauri event (emitted by
 * `check_for_app_update` in `apps/desktop/src-tauri/src/lib.rs` on startup)
 * and exposes a tiny store the Settings > Advanced pane subscribes to so it
 * can render an explicit "Install & Restart" affordance.
 *
 * Deliberately NOT automatic: per US10 AS1, the update is only downloaded and
 * installed when the user clicks the install action, which re-runs the JS
 * plugin's own `check()` to obtain the `Update` handle before calling
 * `downloadAndInstall()` and relaunching.
 *
 * In mock/test mode (VITE_USE_MOCKS=true) the Tauri listen/updater APIs are
 * unavailable; the subscription and install action are no-ops.
 */

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

export interface UpdateAvailableInfo {
  version: string;
  body?: string | null;
}

type Listener = () => void;

let current: UpdateAvailableInfo | null = null;
const listeners = new Set<Listener>();

function setCurrent(info: UpdateAvailableInfo | null): void {
  current = info;
  for (const listener of listeners) listener();
}

export function getUpdateSnapshot(): UpdateAvailableInfo | null {
  return current;
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let unlisten: (() => void) | null = null;
let subscribed = false;

/** Start listening for the backend's `update-available` event (idempotent). */
export async function startUpdateSubscription(): Promise<void> {
  if (subscribed || IS_MOCK) return;
  subscribed = true;

  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen<UpdateAvailableInfo>(
      'update-available',
      (event) => {
        setCurrent(event.payload);
      },
    );
  } catch (err) {
    console.warn('[updateSubscription] listen failed:', err);
  }
}

/** Stop the live listener and clear the current update state. */
export function stopUpdateSubscription(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  subscribed = false;
  setCurrent(null);
}

/**
 * Download and install the pending update, then relaunch the app.
 *
 * Re-checks via the JS plugin (rather than trusting the backend event alone)
 * so we hold the real `Update` handle `downloadAndInstall()` requires. Until
 * the T060 follow-up replaces the placeholder `pubkey`, this will reject —
 * callers should surface the thrown error to the user (FR-030).
 */
export async function installPendingUpdate(): Promise<void> {
  if (IS_MOCK) return;

  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');

  const update = await check();
  if (!update) {
    setCurrent(null);
    return;
  }

  await update.downloadAndInstall();
  await relaunch();
}
