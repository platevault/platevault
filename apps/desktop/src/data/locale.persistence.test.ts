// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale.persistence.test.ts — spec 061 T012.
 *
 * The settings DB (`general` scope, `locale` key) is the durable source of
 * truth for the language choice (research D3); localStorage (`alm.locale`)
 * is a synchronous boot mirror only. Covers the custom strategy's DB
 * write-through and `hydrateLocaleFromSettings`'s DB-wins reconciliation —
 * mirrors `theme.persistence.test.ts`'s mock shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcOutcome =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: unknown };

const isTauriMock = vi.fn<() => boolean>();
const settingsGetMock = vi.fn<(scope: string) => Promise<IpcOutcome>>();
const settingsUpdateMock =
  vi.fn<(scope: string, values: unknown) => Promise<IpcOutcome>>();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (scope: string) => settingsGetMock(scope),
    settingsUpdate: (scope: string, values: unknown) =>
      settingsUpdateMock(scope, values),
  },
}));

/** Poll briefly for an async mock to have been called (mirrors theme.persistence.test.ts). */
async function waitForCall(fn: ReturnType<typeof vi.fn>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('custom-almSettings strategy — write-through to the settings DB', () => {
  beforeEach(() => {
    vi.resetModules();
    isTauriMock.mockReset();
    settingsGetMock.mockReset();
    settingsUpdateMock.mockReset();
    settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setLocale persists to localStorage synchronously and to settings.update when inside Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    const { registerLocaleStrategy } = await import('./locale');
    const { setLocale, getLocale } = await import('@/paraglide/runtime');
    registerLocaleStrategy();

    // Paraglide auto-persists whatever the very first-ever getLocale() call
    // resolves to (opral/inlang-paraglide-js#455) — prime and drain that
    // one-time side effect before asserting on our own explicit call below.
    getLocale();
    await waitForCall(settingsUpdateMock);
    settingsUpdateMock.mockClear();

    void setLocale('pt-BR', { reload: false });

    // The localStorage mirror write is synchronous.
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');

    await waitForCall(settingsUpdateMock);
    expect(settingsUpdateMock).toHaveBeenCalledWith('general', {
      locale: 'pt-BR',
    });
  });

  it('still writes the mirror but skips settings.update outside Tauri (no-op)', async () => {
    isTauriMock.mockReturnValue(false);
    const { registerLocaleStrategy } = await import('./locale');
    const { setLocale } = await import('@/paraglide/runtime');
    registerLocaleStrategy();

    void setLocale('pt-BR', { reload: false });

    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  it('degrades silently when settings.update rejects — never throws', async () => {
    isTauriMock.mockReturnValue(true);
    settingsUpdateMock.mockRejectedValue(new Error('db unavailable'));
    const { registerLocaleStrategy } = await import('./locale');
    const { setLocale } = await import('@/paraglide/runtime');
    registerLocaleStrategy();

    expect(() => setLocale('pt-BR', { reload: false })).not.toThrow();
    await waitForCall(settingsUpdateMock);
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
  });
});

describe('hydrateLocaleFromSettings — DB wins over a disagreeing mirror', () => {
  beforeEach(() => {
    vi.resetModules();
    isTauriMock.mockReset();
    settingsGetMock.mockReset();
    settingsUpdateMock.mockReset();
    settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('overwrites a stale mirror with the DB value', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.locale', 'en-GB');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { locale: 'pt-BR' } },
    });

    const { registerLocaleStrategy, hydrateLocaleFromSettings } = await import(
      './locale'
    );
    registerLocaleStrategy();

    const corrected = await hydrateLocaleFromSettings();

    expect(corrected).toBe('pt-BR');
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
  });

  it('leaves the mirror untouched and returns undefined when the DB already agrees', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.locale', 'pt-BR');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { locale: 'pt-BR' } },
    });

    const { registerLocaleStrategy, hydrateLocaleFromSettings } = await import(
      './locale'
    );
    registerLocaleStrategy();

    const corrected = await hydrateLocaleFromSettings();

    expect(corrected).toBeUndefined();
  });

  it('ignores a malformed/unshipped DB value and keeps the mirror', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.locale', 'en-GB');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { locale: 'fr-FR' } },
    });

    const { registerLocaleStrategy, hydrateLocaleFromSettings } = await import(
      './locale'
    );
    registerLocaleStrategy();

    const corrected = await hydrateLocaleFromSettings();

    expect(corrected).toBeUndefined();
    expect(localStorage.getItem('alm.locale')).toBe('en-GB');
  });

  it('is a no-op outside Tauri (dev server / vitest)', async () => {
    isTauriMock.mockReturnValue(false);
    localStorage.setItem('alm.locale', 'en-GB');

    const { hydrateLocaleFromSettings } = await import('./locale');
    const corrected = await hydrateLocaleFromSettings();

    expect(corrected).toBeUndefined();
    expect(settingsGetMock).not.toHaveBeenCalled();
  });

  it('degrades silently when settings.get rejects — never throws', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.locale', 'en-GB');
    settingsGetMock.mockRejectedValue(new Error('db unavailable'));

    const { hydrateLocaleFromSettings } = await import('./locale');

    await expect(hydrateLocaleFromSettings()).resolves.toBeUndefined();
    expect(localStorage.getItem('alm.locale')).toBe('en-GB');
  });
});
