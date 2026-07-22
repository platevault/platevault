// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocaleProvider,
  registerLocaleStrategy,
  useLocale,
} from '@/data/locale';
import { m } from '@/lib/i18n';
import { StepLanguage } from '@/features/setup/steps/StepLanguage';
import { itemLabel } from './ChecklistSection';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

function LocaleCopyProbe() {
  const { locale } = useLocale();
  return (
    <>
      <output data-testid="active-locale">{locale}</output>
      <p data-testid="wizard-copy">{m.setup_language_desc()}</p>
      <p data-testid="checklist-copy">{itemLabel('inbox.confirm_first')}</p>
      <StepLanguage />
    </>
  );
}

describe('onboarding copy follows the active locale', () => {
  beforeEach(() => {
    localStorage.clear();
    registerLocaleStrategy();
  });

  it('switches to Portuguese and updates visible wizard and checklist copy', () => {
    render(
      <LocaleProvider>
        <LocaleCopyProbe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('active-locale')).toHaveTextContent('en-GB');
    expect(screen.getByTestId('wizard-copy')).toHaveTextContent(
      /^Pick your preferred language$/,
    );

    act(() => {
      screen.getByRole('button', { name: 'Português (Brasil)' }).click();
    });

    expect(screen.getByTestId('active-locale')).toHaveTextContent('pt-BR');
    expect(screen.getByTestId('wizard-copy')).toHaveTextContent(
      /^Escolha seu idioma preferido$/,
    );
    expect(screen.getByTestId('checklist-copy')).toHaveTextContent(
      'Confirme seu primeiro item',
    );
    expect(localStorage.getItem('alm.locale')).toBe('pt-BR');
  });
});
