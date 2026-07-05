// Spec 051 (Tauri Shell Integration), T008 regression guard: `openInNewWindow`
// must still degrade to `window.open` outside Tauri now that the runtime
// check is `core.isTauri()` instead of the old `'__TAURI_INTERNALS__' in
// window` sniff, and must still spawn a `WebviewWindow` inside Tauri.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn();
const webviewWindowCtor = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: webviewWindowCtor,
}));

describe('openInNewWindow', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    isTauriMock.mockReset();
    webviewWindowCtor.mockReset();
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
  });

  it('degrades to window.open outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);

    const { openInNewWindow } = await import('./window');
    await openInNewWindow('/projects?selected=3');

    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = windowOpenSpy.mock.calls[0] as [string, string, string];
    expect(url).toContain('#/projects?selected=3');
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    expect(webviewWindowCtor).not.toHaveBeenCalled();
  });

  it('spawns a WebviewWindow inside Tauri instead of window.open', async () => {
    isTauriMock.mockReturnValue(true);

    const { openInNewWindow } = await import('./window');
    await openInNewWindow('/projects?selected=3');

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(webviewWindowCtor).toHaveBeenCalledTimes(1);
    const [, options] = webviewWindowCtor.mock.calls[0] as [string, { url: string }];
    expect(options.url).toContain('#/projects?selected=3');
  });
});
