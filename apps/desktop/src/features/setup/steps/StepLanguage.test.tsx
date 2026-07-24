// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepLanguage — spec 061 T017-T020.
 *
 * Mirrors locale.provider.test.tsx's mocking: `@tauri-apps/api/core`'s
 * `isTauri` must be mocked (not just `invoke`) or `LocaleProvider`'s mount
 * hydration throws on the un-mocked module's real `isTauri`.
 */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

import { LocaleProvider, registerLocaleStrategy } from '@/data/locale';
import { StepLanguage } from './StepLanguage';

beforeEach(() => {
  registerLocaleStrategy();
  localStorage.clear();
});

function renderStep() {
  return render(
    <LocaleProvider>
      <StepLanguage />
    </LocaleProvider>,
  );
}

describe('StepLanguage', () => {
  it('renders both shipped locales with native name + flag, base locale active', () => {
    renderStep();

    const english = screen.getByRole('button', { name: 'English (UK)' });
    const portuguese = screen.getByRole('button', {
      name: 'Português (Brasil)',
    });
    expect(english).toHaveAttribute('aria-pressed', 'true');
    expect(portuguese).toHaveAttribute('aria-pressed', 'false');
    expect(english).toHaveAttribute('lang', 'en-GB');
    expect(portuguese).toHaveAttribute('lang', 'pt-BR');
    expect(english).toHaveTextContent('🇬🇧');
    expect(portuguese).toHaveTextContent('🇧🇷');
  });

  it('shows the localized machine-translation review notice without disabling the option', () => {
    renderStep();

    const portuguese = screen.getByRole('button', {
      name: 'Português (Brasil)',
    });
    const notice = screen.getByText(
      'This translation was generated automatically and awaits review by a fluent speaker.',
    );
    expect(portuguese).toBeEnabled();
    expect(portuguese).toHaveAttribute('aria-describedby', notice.id);
    expect(notice).toHaveAttribute('lang', 'en-GB');
    expect(
      screen.getByRole('button', { name: 'English (UK)' }),
    ).not.toHaveAttribute('aria-describedby');
  });

  it('is keyboard operable: selecting via click flips the pressed state and mirror', () => {
    renderStep();

    const portuguese = screen.getByRole('button', {
      name: 'Português (Brasil)',
    });
    act(() => {
      portuguese.click();
    });

    expect(portuguese).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'English (UK)' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        'Esta tradução foi gerada automaticamente e aguarda a revisão de uma pessoa fluente.',
      ),
    ).toHaveAttribute('lang', 'pt-BR');
    // changeLocale writes the localStorage mirror synchronously (research D3)
    // — the persistence spec 061 depends on for the choice to survive a
    // subsequent hydration read.
    expect(localStorage.getItem('pv.locale')).toBe('pt-BR');
  });

  it('every option is a real focusable button, so Tab reaches all of them', () => {
    renderStep();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      expect(btn.tabIndex).not.toBe(-1);
    }
  });
});
