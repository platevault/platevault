// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale.storage-unavailable.test.tsx — spec 061 T013.
 *
 * Regression for the split-locale bug confirmed at effcc113: when
 * localStorage.setItem throws, LocaleProvider updated React state +
 * document.lang to the new locale but Paraglide's custom-almSettings strategy
 * fell through to preferredLanguage/baseLocale — so the locale card showed
 * Portuguese while the message catalog rendered English.
 *
 * Fix: setLocaleMirror writes an in-memory fallback before attempting
 * localStorage; getLocaleMirror consults that fallback when localStorage is
 * unavailable, keeping Paraglide's strategy coherent with React state.
 *
 * Why getCurrentLocale() rather than m.*() for the split assertion:
 * vi.resetModules() creates a fresh Paraglide runtime instance per test, but
 * a static top-level `import { m }` binds to the original instance. Asserting
 * on getCurrentLocale() from the dynamically-imported module exercises the
 * same runtime that LocaleProvider wired the strategy into — exactly the
 * invariant the split violated: React state said "pt-BR" while the strategy
 * resolution (and therefore every m.*() call) said "en-GB".
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn<() => boolean>();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));
vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: {} },
    }),
    settingsUpdate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  },
}));

// Resolved dynamically per-test after vi.resetModules().
let useLocaleUnderTest: typeof import('./locale').useLocale;
let LocaleProviderUnderTest: typeof import('./locale').LocaleProvider;
let getCurrentLocaleUnderTest: typeof import('./locale').getCurrentLocale;

function Probe() {
  const { locale, changeLocale } = useLocaleUnderTest();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => changeLocale('pt-BR')}>switch</button>
    </div>
  );
}

describe('split-locale regression — storage unavailable', () => {
  beforeEach(async () => {
    vi.resetModules();
    isTauriMock.mockReturnValue(false);
    // Clear any real localStorage that might be set before making it throw.
    localStorage.clear();
    document.documentElement.lang = 'en-GB';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Paraglide strategy resolves pt-BR when localStorage is entirely unavailable', async () => {
    // Make localStorage throw on both read AND write — simulates a sandboxed
    // environment or a SecurityError-throwing storage.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const mod = await import('./locale');
    mod.registerLocaleStrategy();
    useLocaleUnderTest = mod.useLocale;
    LocaleProviderUnderTest = mod.LocaleProvider;
    getCurrentLocaleUnderTest = mod.getCurrentLocale;

    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    // Switch to Portuguese.
    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });

    // React state and document.lang must both show pt-BR.
    expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');

    // The core invariant the bug violated: Paraglide's strategy resolution must
    // agree with React state. Before the fix, this returned "en-GB" because
    // the strategy fell through when localStorage was unavailable.
    await waitFor(() => {
      expect(getCurrentLocaleUnderTest()).toBe('pt-BR');
    });
  });

  it('Paraglide strategy resolves pt-BR when only setItem throws (getItem still works)', async () => {
    // Simulates a quota-exceeded or read-only storage — setItem fails but
    // getItem still resolves prior values (here: none saved).
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const mod = await import('./locale');
    mod.registerLocaleStrategy();
    useLocaleUnderTest = mod.useLocale;
    LocaleProviderUnderTest = mod.LocaleProvider;
    getCurrentLocaleUnderTest = mod.getCurrentLocale;

    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });

    expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');

    await waitFor(() => {
      expect(getCurrentLocaleUnderTest()).toBe('pt-BR');
    });
  });
});
