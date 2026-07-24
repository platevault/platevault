// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Splash window boot logic (handoff 07). Not React — this window is its own
// Vite entry (splash.html) loaded by the Tauri "splash" window
// (tauri.conf.json), independent of the main app's document.
//
// The splash is the only window Tauri creates for itself; `main` is built by
// the Rust side (`run_app` → `create_main_window`) only once migrations have
// run, so this window is on screen for the whole of database startup. It waits
// for `main`'s "app:boot-ready" event (emitted once from src/main.tsx after
// the first route renders), plays a short CSS fade-out, then shows `main` and
// closes itself. There is no minimum display floor — cold start is already
// gated on migration completing before boot-ready fires.

import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

// Duration must match the CSS transition on .pv-card in splash.html.
export const FADE_MS = 150;
// Fallback so a stuck/never-emitted boot-ready doesn't strand the user behind
// the splash forever. Armed from the moment the `main` window EXISTS, not from
// process start: migration now runs behind this splash and has no bounded
// duration, so a timer started earlier would fire mid-migration and close the
// splash while there is still no window to show — nothing on screen at all,
// which is the failure this whole ordering exists to remove.
export const READY_TIMEOUT_MS = 15_000;
const MAIN_POLL_MS = 250;

const versionEl = document.getElementById('pv-version');
if (versionEl) {
  const version = import.meta.env.VITE_APP_VERSION ?? '';
  versionEl.textContent = version ? `v${version}` : '';
}

// Exported so tests can mock performance.now without touching global state.
export const splashStart = performance.now();
let closing = false;

// Timestamp log for warm-start diagnostics. Each call appends a labelled entry
// to the console so the deltas between splash-shown, boot-ready, and
// window-shown are visible in dev-tools / Tauri's log output.
function logTimestamp(label: string): void {
  const elapsed = (performance.now() - splashStart).toFixed(1);
  // eslint-disable-next-line no-console
  console.debug(`[splash] ${label} +${elapsed}ms`);
}

logTimestamp('splash-shown');

async function findMainWindow() {
  const windows = await getAllWindows();
  return windows.find((w) => w.label === 'main');
}

async function closeSplashAndShowMain(): Promise<void> {
  if (closing) return;
  closing = true;

  logTimestamp('boot-ready-received');

  // Trigger the CSS fade-out before dismissing the window so warm-start
  // dismissal doesn't hard-cut. The .pv-fading class sets opacity:0 with a
  // 150ms transition (matching FADE_MS). We wait for it before proceeding.
  const card = document.querySelector<HTMLElement>('.pv-card');
  if (card) {
    card.classList.add('pv-fading');
    await new Promise((resolve) => setTimeout(resolve, FADE_MS));
  }

  const main = await findMainWindow();
  if (main) {
    await main.show();
    await main.setFocus();
    logTimestamp('window-shown');
  }
  await getCurrentWindow().close();
}

void listen('app:boot-ready', () => {
  void closeSplashAndShowMain();
});

// Polled rather than driven by a "main created" event: this document loads
// asynchronously, so a one-shot event emitted while it was still parsing would
// be missed and the fallback would never arm at all.
async function armReadyTimeoutWhenMainExists(): Promise<void> {
  while (!closing) {
    if (await findMainWindow()) {
      setTimeout(() => {
        void closeSplashAndShowMain();
      }, READY_TIMEOUT_MS);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MAIN_POLL_MS));
  }
}
void armReadyTimeoutWhenMainExists();
