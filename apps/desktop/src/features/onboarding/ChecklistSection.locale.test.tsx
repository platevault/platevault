// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

import {
  LocaleProvider,
  registerLocaleStrategy,
  useLocale,
} from '@/data/locale';
import { m } from '@/lib/i18n';

function WizardCopyProbe() {
  const { locale, changeLocale } = useLocale();

  return (
    <>
      <output data-testid="locale">{locale}</output>
      <p>{m.setup_language_desc()}</p>
      <button type="button" onClick={() => changeLocale('pt-BR')}>
        Português (Brasil)
      </button>
    </>
  );
}

beforeEach(() => {
  registerLocaleStrategy();
  localStorage.clear();
});

describe('wizard copy follows the active locale', () => {
  it('switches to Portuguese-Brazil and renders the translated prompt', () => {
    render(
      <LocaleProvider>
        <WizardCopyProbe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('en-GB');
    expect(screen.getByText('Pick your preferred language')).toBeVisible();

    act(() => {
      screen.getByRole('button', { name: 'Português (Brasil)' }).click();
    });

    expect(screen.getByTestId('locale')).toHaveTextContent('pt-BR');
    expect(screen.getByText('Escolha seu idioma preferido')).toBeVisible();
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
  });
});
