// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Spec 020 — Router & URL State (desktop rescope), US4 multi-window.
//
// Open the current route + search in a NEW, independent desktop window. A fully
// URL-described ledger view (spec 020) makes this trivial: spawn a second Tauri
// webview pointed at the same hash route. Outside Tauri (browser/dev) it
// degrades to `window.open` so it never crashes.
//
// Spec 051 T008: uses `@tauri-apps/api/core`'s `isTauri()` (the pinned,
// official runtime check) instead of a hand-rolled `'__TAURI_INTERNALS__' in
// window` sniff.

let windowSeq = 0;

/**
 * Open `path` (a hash route like `/projects?selected=3`, no leading `#`) in a
 * new window. Returns a promise that resolves once the window is requested.
 */
export async function openInNewWindow(path: string): Promise<void> {
  const hashPath = path.startsWith('#') ? path.slice(1) : path;
  const base = window.location.href.split('#')[0];
  const fullUrl = `${base}#${hashPath}`;

  // Lazy imports so the Tauri API is never pulled into browser-only builds.
  const { isTauri } = await import('@tauri-apps/api/core');

  if (!isTauri()) {
    window.open(fullUrl, '_blank', 'noopener');
    return;
  }

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `alm-win-${Date.now()}-${windowSeq++}`;
  new WebviewWindow(label, {
    url: fullUrl,
    // eslint-disable-next-line alm/no-user-string -- product/brand name, not translatable
    title: 'PlateVault',
    width: 1280,
    height: 800,
  });
}
