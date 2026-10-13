// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * StepLanguage — native menu relabel (astro-plan-bw4s6).
 *
 * On a first run the shell builds the native menu in the base locale, because
 * nothing is saved yet. Choosing a language in the setup wizard's Language
 * step must relabel that menu straight away, through `LocaleProvider`'s
 * existing locale-change path, not on the next launch.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMenuSetLabelsMock =
  vi.fn<(labels: unknown) => Promise<{ status: string; data: null }>>();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    // Nothing saved yet: the first-run state.
    settingsGet: async (scope: string) => ({
      status: 'ok',
      data: { scope, values: {} },
    }),
    settingsUpdate: async () => ({ status: 'ok', data: null }),
    nativeMenuSetLabels: (labels: unknown) => nativeMenuSetLabelsMock(labels),
  },
}));

import { LocaleProvider, registerLocaleStrategy } from '@/data/locale';
import { nativeMenuLabels } from '@/data/nativeMenu';
import { StepLanguage } from './StepLanguage';

beforeEach(() => {
  registerLocaleStrategy();
  localStorage.clear();
  nativeMenuSetLabelsMock.mockReset();
  nativeMenuSetLabelsMock.mockResolvedValue({ status: 'ok', data: null });
});

describe('StepLanguage native menu', () => {
  it('relabels the native menu in pt-BR as soon as Português is chosen', async () => {
    render(
      <LocaleProvider>
        <StepLanguage />
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(1);
    });
    expect(nativeMenuSetLabelsMock).toHaveBeenLastCalledWith(
      nativeMenuLabels('en-GB'),
    );

    act(() => {
      screen.getByRole('button', { name: 'Português (Brasil)' }).click();
    });

    await waitFor(() => {
      expect(nativeMenuSetLabelsMock).toHaveBeenCalledTimes(2);
    });
    expect(nativeMenuSetLabelsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        about: 'Sobre o PlateVault',
        quit: 'Encerrar PlateVault',
        selectAll: 'Selecionar tudo',
        closeWindow: 'Fechar janela',
      }),
    );
  });
});
