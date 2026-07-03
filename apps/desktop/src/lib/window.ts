// Spec 020 — Router & URL State (desktop rescope), US4 multi-window.
//
// Open the current route + search in a NEW, independent desktop window. A fully
// URL-described ledger view (spec 020) makes this trivial: spawn a second Tauri
// webview pointed at the same hash route. Outside Tauri (browser/dev) it
// degrades to `window.open` so it never crashes.

/** Runtime Tauri check — safe to call in a plain browser (no import side effects). */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let windowSeq = 0;

/**
 * Open `path` (a hash route like `/projects?selected=3`, no leading `#`) in a
 * new window. Returns a promise that resolves once the window is requested.
 */
export async function openInNewWindow(path: string): Promise<void> {
  const hashPath = path.startsWith('#') ? path.slice(1) : path;
  const base = window.location.href.split('#')[0];
  const fullUrl = `${base}#${hashPath}`;

  if (!inTauri()) {
    window.open(fullUrl, '_blank', 'noopener');
    return;
  }

  // Lazy import so the Tauri API is never pulled into browser-only builds.
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
