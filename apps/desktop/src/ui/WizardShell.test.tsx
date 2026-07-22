// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { WizardShell, type WizardStep } from './WizardShell';

const LABELS = ['Language', 'Sources', 'Tools'];
const HEADINGS = [
  'Choose your language',
  'Where does your data live?',
  'Configure processing tools',
];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'scrollIntoView',
);
const scrollIntoView = vi.fn();

function matchMedia(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  vi.stubGlobal('matchMedia', matchMedia(false));
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(
      Element.prototype,
      'scrollIntoView',
      originalScrollIntoView,
    );
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

function Harness({
  onSelect = vi.fn(),
}: {
  onSelect?: (step: number) => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const steps: WizardStep[] = LABELS.map((label, index) => ({
    label,
    completed: index < currentStep,
  }));

  return (
    <WizardShell
      steps={steps}
      currentStep={currentStep}
      footer={<button type="button">Continue</button>}
      onStepSelect={(step) => {
        onSelect(step);
        setCurrentStep(step);
      }}
    >
      <h1>{HEADINGS[currentStep]}</h1>
      <p>Step content</p>
    </WizardShell>
  );
}

describe('WizardShell accessible step navigation', () => {
  it('exposes current, completed, and pending progress without inline styles', () => {
    const steps: WizardStep[] = [
      { label: LABELS[0], completed: true },
      { label: LABELS[1] },
      { label: LABELS[2] },
    ];
    const { container } = render(
      <WizardShell steps={steps} currentStep={1} summary={<p>Summary</p>}>
        <h2>{HEADINGS[1]}</h2>
      </WizardShell>,
    );

    const progress = screen.getByRole('navigation');
    const items = [...progress.querySelectorAll('.pv-wizard__step')];
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual([
      'completed',
      'active',
      'pending',
    ]);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('uses native buttons for pointer and keyboard-compatible activation', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    const sources = screen.getByRole('button', { name: '2. Sources' });
    expect(sources.tagName).toBe('BUTTON');
    expect(sources).toHaveAttribute('type', 'button');
    sources.focus();
    fireEvent.click(sources, { detail: 0 });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('focuses the new step heading after forward and backward pointer navigation', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '2. Sources' }));
    const sourcesHeading = screen.getByRole('heading', {
      name: HEADINGS[1],
    });
    await waitFor(() => expect(sourcesHeading).toHaveFocus());
    expect(sourcesHeading).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(screen.getByRole('button', { name: '1. Language' }));
    const languageHeading = screen.getByRole('heading', {
      name: HEADINGS[0],
    });
    await waitFor(() => expect(languageHeading).toHaveFocus());
  });

  it('does not steal focus on initial render', () => {
    render(
      <>
        <button type="button">Before wizard</button>
        <Harness />
      </>,
    );
    const before = screen.getByRole('button', { name: 'Before wizard' });
    before.focus();
    expect(before).toHaveFocus();
  });

  it('scrolls the active progress control without animation when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', matchMedia(true));
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '2. Sources' }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
      }),
    );
  });

  it('keeps the pinned footer outside the scrolling step body', () => {
    const { container } = render(<Harness />);
    const scroll = container.querySelector<HTMLElement>('.pv-wizard__scroll');
    const footer = container.querySelector<HTMLElement>('.pv-wizard__footer');
    const footerInner = container.querySelector<HTMLElement>(
      '.pv-wizard__footer-inner',
    );
    expect(scroll).not.toContainElement(footer);
    expect(footer).toContainElement(footerInner);
  });
});
