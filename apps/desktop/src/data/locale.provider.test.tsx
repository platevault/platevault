// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale.provider.test.tsx — spec 061 T008/T009.
 *
 * `LocaleProvider`/`useLocale`: `changeLocale` applies without a reload
 * (research D2) and re-renders consumers; the provider hydrates from the
 * settings DB on mount and adopts a DB-corrected locale.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn<() => boolean>();
const settingsGetMock =
  vi.fn<(scope: string) => Promise<{ status: string; data: unknown }>>();
const settingsUpdateMock =
  vi.fn<
    (scope: string, values: unknown) => Promise<{ status: string; data: null }>
  >();

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

function Probe() {
  const { locale, changeLocale } = useLocaleUnderTest();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => changeLocale('pt-BR')}>switch</button>
      <button
        onClick={() => changeLocale('not-a-shipped-locale' as typeof locale)}
      >
        invalid
      </button>
    </div>
  );
}

// Resolved dynamically per-test after vi.resetModules(), so each test gets
// the module instance matching its own mocks.
let useLocaleUnderTest: typeof import('./locale').useLocale;
let LocaleProviderUnderTest: typeof import('./locale').LocaleProvider;

describe('LocaleProvider / useLocale', () => {
  beforeEach(async () => {
    vi.resetModules();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
    settingsGetMock.mockReset();
    settingsUpdateMock.mockReset();
    settingsUpdateMock.mockResolvedValue({ status: 'ok', data: null });
    localStorage.clear();
    document.documentElement.lang = 'en';

    const mod = await import('./locale');
    mod.registerLocaleStrategy();
    useLocaleUnderTest = mod.useLocale;
    LocaleProviderUnderTest = mod.LocaleProvider;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('changeLocale re-renders consumers with the new locale, without a reload', async () => {
    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale').textContent).toBe('en-GB');
    });

    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });

    expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('sets the canonical saved locale on the document during startup', () => {
    localStorage.setItem('alm.locale', 'pt-BR');

    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('falls back safely when a caller supplies an unshipped locale', () => {
    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
      screen.getByRole('button', { name: 'invalid' }).click();
    });

    expect(screen.getByTestId('locale').textContent).toBe('en-GB');
    expect(localStorage.getItem('alm.locale')).toBe('en-GB');
    expect(document.documentElement.lang).toBe('en-GB');
  });

  it('adopts a DB-corrected locale discovered during mount hydration', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('alm.locale', 'en-GB');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { locale: 'pt-BR' } },
    });

    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('en-GB');

    await waitFor(() => {
      expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
    });
    expect(document.documentElement.lang).toBe('pt-BR');
  });
});
