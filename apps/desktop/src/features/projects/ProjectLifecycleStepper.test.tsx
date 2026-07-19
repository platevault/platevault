// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectLifecycleStepper tests — spec 043 task #74, #833.
 *
 * Covers: all stages render, the current stage is marked active, prior stages
 * read as done, a next-action line is present, blocked projects get a
 * trailing danger chip, History is a collapsible (closed by default), and
 * (#833) the History section renders the project's audit trail — transitions
 * with from→to state/outcome/actor — with an empty state when there is none.
 * Also covers the `/shell/projects` route `selected`-search-param fallback
 * used when the (optional) `projectId` prop isn't passed — see the prop's
 * doc comment on `ProjectLifecycleStepperProps` for why.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockUseSearch } = vi.hoisted(() => ({ mockUseSearch: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: mockUseSearch,
}));

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return { ...original, useProjectHistory: vi.fn() };
});

import { ProjectLifecycleStepper } from './ProjectLifecycleStepper';
import { useProjectHistory } from './store';
import type { AuditEntry } from '@/bindings/index';

const TS = {
  projectId: 'proj-1',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-10T00:00:00Z',
};

const mockUseProjectHistory = vi.mocked(useProjectHistory);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function historyEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit-1',
    timestamp: '2026-07-01T00:00:00Z',
    eventType: 'project: ready -> processing',
    entityType: 'project',
    entityId: 'proj-1',
    fromState: 'ready',
    toState: 'processing',
    actor: 'user',
    outcome: 'applied',
    detail: 'project: ready -> processing',
    detailCode: null,
    detailParams: null,
    ...overrides,
  };
}

describe('ProjectLifecycleStepper', () => {
  beforeEach(() => {
    // Default: empty, loaded history and no route selection — individual
    // tests override as needed.
    mockUseProjectHistory.mockReturnValue({
      data: [],
      loading: false,
      error: undefined,
    });
    mockUseSearch.mockReturnValue({
      selected: undefined,
      lifecycle: undefined,
    });
  });

  it('renders the stepper container and all lifecycle stages', () => {
    render(<ProjectLifecycleStepper state="processing" {...TS} />, {
      wrapper,
    });
    expect(screen.getByTestId('project-lifecycle-stepper')).toBeInTheDocument();
    for (const stage of [
      'setup',
      'ready',
      'prepared',
      'processing',
      'completed',
      'archived',
    ]) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }
  });

  it('marks the current stage active and prior stages done', () => {
    const { container } = render(
      <ProjectLifecycleStepper state="prepared" {...TS} />,
      { wrapper },
    );
    const active = container.querySelector('.alm-stepper__chip--active');
    expect(active).toHaveTextContent('prepared');
    // setup + ready precede prepared → both done.
    expect(container.querySelectorAll('.alm-stepper__chip--done')).toHaveLength(
      2,
    );
  });

  it('renders a contextual next-action line', () => {
    render(<ProjectLifecycleStepper state="processing" {...TS} />, {
      wrapper,
    });
    expect(screen.getByText(/record an accepted output/i)).toBeInTheDocument();
  });

  it('renders a trailing blocked chip for blocked projects', () => {
    const { container } = render(
      <ProjectLifecycleStepper state="blocked" {...TS} />,
      { wrapper },
    );
    const blocked = container.querySelector('.alm-stepper__chip--blocked');
    expect(blocked).toHaveTextContent('blocked');
    // No active chip when off-track.
    expect(container.querySelector('.alm-stepper__chip--active')).toBeNull();
  });

  it('keeps History collapsed by default and expands on click', () => {
    render(<ProjectLifecycleStepper state="ready" {...TS} />, { wrapper });
    expect(screen.queryByText(/created/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('History'));
    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
  });

  it('renders transitions from the audit trail, newest-first as given by the query', () => {
    mockUseProjectHistory.mockReturnValue({
      data: [
        historyEntry({
          id: 'audit-2',
          fromState: 'processing',
          toState: 'completed',
          outcome: 'applied',
          actor: 'user',
        }),
        historyEntry({
          id: 'audit-1',
          fromState: 'ready',
          toState: 'processing',
          outcome: 'refused',
          actor: 'system',
        }),
      ],
      loading: false,
      error: undefined,
    });
    render(<ProjectLifecycleStepper state="processing" {...TS} />, {
      wrapper,
    });
    fireEvent.click(screen.getByText('History'));

    const rows = screen.getAllByText(/→/);
    expect(rows[0]).toHaveTextContent('processing → completed');
    expect(rows[1]).toHaveTextContent('ready → processing');
    expect(screen.getByText('system')).toBeInTheDocument();
  });

  it('renders an empty state when the project has no audit history', () => {
    mockUseProjectHistory.mockReturnValue({
      data: [],
      loading: false,
      error: undefined,
    });
    render(<ProjectLifecycleStepper state="ready" {...TS} />, { wrapper });
    fireEvent.click(screen.getByText('History'));
    expect(
      screen.getByText(/no lifecycle history recorded/i),
    ).toBeInTheDocument();
  });

  it('falls back to the /shell/projects route selected search param when projectId is not passed', () => {
    mockUseSearch.mockReturnValue({
      selected: 'proj-route-1',
      lifecycle: undefined,
    });
    const { projectId: _unused, ...rest } = TS;
    render(<ProjectLifecycleStepper state="ready" {...rest} />, { wrapper });
    expect(mockUseProjectHistory).toHaveBeenCalledWith('proj-route-1');
  });

  it('prefers an explicit projectId prop over the route search param', () => {
    mockUseSearch.mockReturnValue({
      selected: 'proj-route-1',
      lifecycle: undefined,
    });
    render(<ProjectLifecycleStepper state="ready" {...TS} />, { wrapper });
    expect(mockUseProjectHistory).toHaveBeenCalledWith('proj-1');
  });
});
