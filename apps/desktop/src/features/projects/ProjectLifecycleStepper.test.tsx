/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectLifecycleStepper tests — spec 043 task #74.
 *
 * The compact horizontal stepper that replaced the vertical lifecycle rail.
 * Covers: all stages render, the current stage is marked active, prior stages
 * read as done, a next-action line is present, blocked projects get a trailing
 * danger chip, and History is a collapsible (closed by default).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProjectLifecycleStepper } from './ProjectLifecycleStepper';

const TS = { createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z' };

describe('ProjectLifecycleStepper', () => {
  it('renders the stepper container and all lifecycle stages', () => {
    render(<ProjectLifecycleStepper state="processing" {...TS} />);
    expect(screen.getByTestId('project-lifecycle-stepper')).toBeInTheDocument();
    for (const stage of ['setup', 'ready', 'prepared', 'processing', 'completed', 'archived']) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }
  });

  it('marks the current stage active and prior stages done', () => {
    const { container } = render(<ProjectLifecycleStepper state="prepared" {...TS} />);
    const active = container.querySelector('.alm-stepper__chip--active');
    expect(active).toHaveTextContent('prepared');
    // setup + ready precede prepared → both done.
    expect(container.querySelectorAll('.alm-stepper__chip--done')).toHaveLength(2);
  });

  it('renders a contextual next-action line', () => {
    render(<ProjectLifecycleStepper state="processing" {...TS} />);
    expect(screen.getByText(/record an accepted output/i)).toBeInTheDocument();
  });

  it('renders a trailing blocked chip for blocked projects', () => {
    const { container } = render(<ProjectLifecycleStepper state="blocked" {...TS} />);
    const blocked = container.querySelector('.alm-stepper__chip--blocked');
    expect(blocked).toHaveTextContent('blocked');
    // No active chip when off-track.
    expect(container.querySelector('.alm-stepper__chip--active')).toBeNull();
  });

  it('keeps History collapsed by default and expands on click', () => {
    render(<ProjectLifecycleStepper state="ready" {...TS} />);
    expect(screen.queryByText(/created/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('History'));
    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
  });
});
