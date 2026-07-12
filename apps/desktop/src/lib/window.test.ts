/**
 * window.test.ts — regression coverage for spec 051 T008.
 *
 * `openInNewWindow` used to sniff `'__TAURI_INTERNALS__' in window` directly;
 * it now defers to `@tauri-apps/api/core`'s official `isTauri()`. This test
 * locks in the one behavior that mattered before and after the swap: outside
 * Tauri, `openInNewWindow` degrades to `window.open` and never touches
 * `WebviewWindow` — it must keep doing that with no behavior change.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn<() => boolean>();
const webviewWindowCtor = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor(...args: unknown[]) {
      webviewWindowCtor(...args);
    }
  },
}));

describe('openInNewWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    isTauriMock.mockReset();
    webviewWindowCtor.mockReset();
  });

  it('degrades to window.open outside Tauri (isTauri() === false)', async () => {
    isTauriMock.mockReturnValue(false);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { openInNewWindow } = await import('./window');
    await openInNewWindow('/projects?selected=3');

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(String(url)).toContain('#/projects?selected=3');
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    expect(webviewWindowCtor).not.toHaveBeenCalled();
  });

  it('opens a WebviewWindow inside Tauri (isTauri() === true), not window.open', async () => {
    isTauriMock.mockReturnValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { openInNewWindow } = await import('./window');
    await openInNewWindow('/targets');

    expect(webviewWindowCtor).toHaveBeenCalledTimes(1);
    const [label, options] = webviewWindowCtor.mock.calls[0] as [
      string,
      { url: string },
    ];
    expect(label).toMatch(/^alm-win-/);
    expect(options.url).toContain('#/targets');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
