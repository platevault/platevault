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
import { nativeMenuLabels } from './nativeMenu';

const isTauriMock = vi.fn<() => boolean>();
const settingsGetMock =
  vi.fn<(scope: string) => Promise<{ status: string; data: unknown }>>();
const settingsUpdateMock =
  vi.fn<
    (scope: string, values: unknown) => Promise<{ status: string; data: null }>
  >();
const nativeMenuSetLabelsMock =
  vi.fn<
    (
      labels: unknown,
    ) => Promise<{ status: string; data?: null; error?: unknown }>
  >();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (scope: string) => settingsGetMock(scope),
    settingsUpdate: (scope: string, values: unknown) =>
      settingsUpdateMock(scope, values),
    nativeMenuSetLabels: (labels: unknown) => nativeMenuSetLabelsMock(labels),
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
    nativeMenuSetLabelsMock.mockReset();
    nativeMenuSetLabelsMock.mockResolvedValue({ status: 'ok', data: null });
    localStorage.clear();
    document.documentElement.lang = 'en';

    const mod = await import('./locale');
    // The provider loads the menu catalogue lazily. Loading this registry's
    // copy now lets every send settle inside its own test instead of landing
    // in the next one.
    await import('./nativeMenu');
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
    expect(localStorage.getItem('pv.locale')).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('sets the canonical saved locale on the document during startup', () => {
    localStorage.setItem('pv.locale', 'pt-BR');

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
    expect(localStorage.getItem('pv.locale')).toBe('en-GB');
    expect(document.documentElement.lang).toBe('en-GB');
  });

  it('adopts a DB-corrected locale discovered during mount hydration', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('pv.locale', 'en-GB');
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

  it('sends the pt-BR native menu labels when switching from en-GB', async () => {
    isTauriMock.mockReturnValue(true);
    localStorage.setItem('pv.locale', 'en-GB');
    settingsGetMock.mockResolvedValue({
      status: 'ok',
      data: { scope: 'general', values: { locale: 'en-GB' } },
    });

    render(
      <LocaleProviderUnderTest>
        <Probe />
      </LocaleProviderUnderTest>,
    );

    await waitFor(() => {
      expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(1);
    });
    expect(nativeMenuSetLabelsMock).toHaveBeenLastCalledWith(
      nativeMenuLabels('en-GB'),
    );
    expect(nativeMenuSetLabelsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ about: 'About PlateVault' }),
    );

    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });

    await waitFor(() => {
      expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(2);
    });
    expect(nativeMenuSetLabelsMock).toHaveBeenLastCalledWith({
      about: 'Sobre o PlateVault',
      settings: 'Configurações…',
      quit: 'Encerrar PlateVault',
      edit: 'Editar',
      undo: 'Desfazer',
      redo: 'Refazer',
      cut: 'Recortar',
      copy: 'Copiar',
      paste: 'Colar',
      selectAll: 'Selecionar tudo',
      window: 'Janela',
      minimise: 'Minimizar',
      closeWindow: 'Fechar janela',
    });
  });

  it.each([
    [
      'resolves an error envelope',
      () =>
        nativeMenuSetLabelsMock.mockResolvedValue({
          status: 'error',
          error: { code: 'INTERNAL_ERROR', message: 'menu refused' },
        }),
    ],
    [
      'rejects',
      () =>
        nativeMenuSetLabelsMock.mockRejectedValue(new Error('IPC unavailable')),
    ],
  ])(
    'still switches to pt-BR when relabelling the native menu %s',
    async (_case, failSetLabels) => {
      failSetLabels();
      isTauriMock.mockReturnValue(true);
      localStorage.setItem('pv.locale', 'en-GB');
      settingsGetMock.mockResolvedValue({
        status: 'ok',
        data: { scope: 'general', values: { locale: 'en-GB' } },
      });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        render(
          <LocaleProviderUnderTest>
            <Probe />
          </LocaleProviderUnderTest>,
        );
        await waitFor(() => {
          expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(1);
        });

        act(() => {
          screen.getByRole('button', { name: 'switch' }).click();
        });

        expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
        await waitFor(() => {
          expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(2);
        });
        // Let the failed sends settle, so a rejection escaping them would
        // reach the listener before it is removed.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
        expect(document.documentElement.lang).toBe('pt-BR');
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
  );
});
