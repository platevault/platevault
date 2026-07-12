/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MoonSummary, phaseLabel } from './MoonSummary';
import { computeObservingNight } from './astro/moon-state';
import { observingNightAnchor } from './astro/observing-night';

/** Build a real ObservingNight for a fixed instant (deterministic fixtures). */
function nightAt(iso: string) {
  const midnight = new Date(iso);
  return computeObservingNight({ nightKey: iso.slice(0, 10), midnight });
}

describe('MoonSummary', () => {
  it('renders the full-Moon phase + high illumination on a known full-Moon date', () => {
    render(<MoonSummary night={nightAt('2024-01-25T17:54:00Z')} />);
    expect(screen.getByTestId('moon-summary')).toBeInTheDocument();
    expect(screen.getByText('Full Moon')).toBeInTheDocument();
    // ~100% illuminated.
    expect(screen.getByText(/100% illuminated/)).toBeInTheDocument();
  });

  it('renders the new-Moon phase with ~0% illumination', () => {
    render(<MoonSummary night={nightAt('2024-08-04T11:13:00Z')} />);
    expect(screen.getByText('New Moon')).toBeInTheDocument();
    expect(screen.getByText(/0% illuminated/)).toBeInTheDocument();
  });

  it('exposes an accessible text equivalent via aria-label', () => {
    render(<MoonSummary night={nightAt('2015-06-24T11:03:00Z')} />);
    const el = screen.getByTestId('moon-summary');
    expect(el.getAttribute('aria-label')).toMatch(/Moon tonight:/);
    expect(el.getAttribute('aria-label')).toMatch(/percent illuminated/);
  });

  it('is stable across a simulated midnight within the same night', () => {
    // The anchor is stable across the 00:00 boundary (same nightKey), so the
    // summary a second before and after midnight is identical.
    const before = observingNightAnchor(new Date(2026, 6, 4, 23, 59));
    const after = observingNightAnchor(new Date(2026, 6, 5, 0, 1));
    expect(before.nightKey).toBe(after.nightKey);
    const { rerender } = render(
      <MoonSummary night={computeObservingNight(before)} />,
    );
    const firstPhase = screen
      .getByTestId('moon-summary')
      .querySelector('.alm-moon-summary__phase')?.textContent;
    rerender(<MoonSummary night={computeObservingNight(after)} />);
    const secondPhase = screen
      .getByTestId('moon-summary')
      .querySelector('.alm-moon-summary__phase')?.textContent;
    expect(firstPhase).toBe(secondPhase);
  });
});

describe('phaseLabel', () => {
  it('maps every phase name to a non-empty label', () => {
    for (const p of [
      'new',
      'waxing-crescent',
      'first-quarter',
      'waxing-gibbous',
      'full',
      'waning-gibbous',
      'last-quarter',
      'waning-crescent',
    ] as const) {
      expect(phaseLabel(p).length).toBeGreaterThan(0);
    }
  });
});
