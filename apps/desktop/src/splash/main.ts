// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Splash window boot logic (handoff 07). Not React — this window is its own
// Vite entry (splash.html) loaded by the Tauri "splash" window
// (tauri.conf.json), independent of the main app's document.
//
// The splash is the only window Tauri creates for itself; `main` is built by
// the Rust side (`run_app` → `create_main_window`) only once migrations have
// run, so this window is on screen for the whole of database startup. It holds
// a minimum display time, waits for `main`'s "app:boot-ready" event (emitted
// once from src/main.tsx after the first route renders), then shows `main` and
// closes itself.

import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

const MIN_DISPLAY_MS = 800;
// Fallback so a stuck/never-emitted boot-ready doesn't strand the user behind
// the splash forever. Armed from the moment the `main` window EXISTS, not from
// process start: migration now runs behind this splash and has no bounded
// duration, so a timer started earlier would fire mid-migration and close the
// splash while there is still no window to show — nothing on screen at all,
// which is the failure this whole ordering exists to remove.
const READY_TIMEOUT_MS = 15_000;
const MAIN_POLL_MS = 250;

const versionEl = document.getElementById('pv-version');
if (versionEl) {
  const version = import.meta.env.VITE_APP_VERSION ?? '';
  versionEl.textContent = version ? `v${version}` : '';
}

const start = performance.now();
let closing = false;

async function findMainWindow() {
  const windows = await getAllWindows();
  return windows.find((w) => w.label === 'main');
}

async function closeSplashAndShowMain(): Promise<void> {
  if (closing) return;
  closing = true;

  const elapsed = performance.now() - start;
  if (elapsed < MIN_DISPLAY_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_DISPLAY_MS - elapsed),
    );
  }

  const main = await findMainWindow();
  if (main) {
    await main.show();
    await main.setFocus();
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
