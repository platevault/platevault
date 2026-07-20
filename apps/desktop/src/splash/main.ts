// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Splash window boot logic (handoff 07). Not React — this window is its own
// Vite entry (splash.html) loaded by the Tauri "splash" window
// (tauri.conf.json), independent of the main app's document. It holds a
// minimum 800ms display, waits for the main window's "app:boot-ready"
// event (emitted once from src/main.tsx after the first route renders —
// see that file for why this is a boot-paint proxy, not a true
// migration-complete signal), then shows `main` and closes itself.

import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

const MIN_DISPLAY_MS = 800;
// Fallback so a stuck/never-emitted boot-ready doesn't strand the user
// behind the splash forever — the app still becomes visible, just without
// waiting on the (best-effort) readiness signal.
const READY_TIMEOUT_MS = 15_000;

const versionEl = document.getElementById('pv-version');
if (versionEl) {
  const version = import.meta.env.VITE_APP_VERSION ?? '';
  versionEl.textContent = version ? `v${version}` : '';
}

const start = performance.now();
let closing = false;

async function closeSplashAndShowMain(): Promise<void> {
  if (closing) return;
  closing = true;

  const elapsed = performance.now() - start;
  if (elapsed < MIN_DISPLAY_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_DISPLAY_MS - elapsed),
    );
  }

  const windows = await getAllWindows();
  const main = windows.find((w) => w.label === 'main');
  if (main) {
    await main.show();
    await main.setFocus();
  }
  await getCurrentWindow().close();
}

void listen('app:boot-ready', () => {
  void closeSplashAndShowMain();
});
setTimeout(() => {
  void closeSplashAndShowMain();
}, READY_TIMEOUT_MS);
