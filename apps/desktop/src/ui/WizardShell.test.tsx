// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WizardShell } from './WizardShell';

describe('WizardShell centered layout', () => {
  it('places the footer after content in the scroll flow without changing control state or order', () => {
    const { container } = render(
      <WizardShell
        steps={[{ label: 'Details' }]}
        currentStep={0}
        onStepSelect={vi.fn()}
        footer={
          <>
            <button type="button" disabled>
              Back
            </button>
            <button type="button" aria-busy="true" disabled>
              Saving
            </button>
          </>
        }
      >
        <button type="button">Content action</button>
      </WizardShell>,
    );

    const scroll = container.querySelector<HTMLElement>('.pv-wizard__scroll');
    const content = container.querySelector<HTMLElement>(
      '.pv-wizard__content--centered',
    );
    const footer = container.querySelector<HTMLElement>('.pv-wizard__footer');
    expect(scroll).toContainElement(content);
    expect(scroll).toContainElement(footer);
    expect(content).toContainElement(footer);
    expect(content?.lastElementChild).toBe(footer);

    const progress = screen.getByRole('navigation', {
      name: 'Setup progress',
    });
    expect(progress).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1. Details' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    const saving = screen.getByRole('button', { name: 'Saving' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');

    expect(
      Array.from(container.querySelectorAll('button')).map(
        (button) => button.textContent,
      ),
    ).toEqual(['1. Details', 'Content action', 'Back', 'Saving']);
  });
});
