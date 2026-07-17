// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Regression test for the backlog defect: "Wizard duplicate-name error banner
 * not persisting."
 *
 * Root cause: `handleCreate()` sets `createError` AND jumps `currentStep` back
 * to 0. Because `StepName` is only mounted while `currentStep === 0`, going
 * from step 5 (Review) back to step 0 remounts it fresh. `StepName`'s resync
 * effect (`reset(data)`, added for "Reset wizard" support) fires react-hook-
 * form's `watch()` subscription even though the values are unchanged from
 * `defaultValues` — which called `onChange()` back up to `WizardPage`, which
 * unconditionally cleared the just-set `createError` via
 * `clearNameToolCreateError()`. The banner was set and cleared inside the same
 * remount, so the user saw it flash (or not at all) instead of persisting.
 *
 * This test uses the REAL `StepName` (unlike WizardPage.test.tsx, which stubs
 * it) so the remount/reset interaction actually reproduces the bug.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn().mockReturnValue(undefined),
  useSearch: () => ({}),
}));

vi.mock('@/features/projects/store', () => ({
  callCreateProject: vi.fn(),
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
}));

const { mockListProjects, mockSessionsList } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockSessionsList: vi.fn(),
}));
vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: {
      ...original.commands,
      projectsList: mockListProjects,
      sessionsList: mockSessionsList,
    },
  };
});

// Stub every step EXCEPT StepName — the real StepName is what remounts and
// fires the spurious reset()-driven onChange that caused the original bug.
vi.mock('./StepSources', () => ({
  StepSources: ({
    onChange,
  }: {
    onChange: (d: { selectedSessionIds: string[] }) => void;
  }) => (
    <div data-testid="step-sources">
      <button
        onClick={() =>
          onChange({ selectedSessionIds: ['sess-001', 'sess-002'] })
        }
      >
        Select sessions
      </button>
    </div>
  ),
}));

vi.mock('./StepCalibration', () => ({
  StepCalibration: () => <div data-testid="step-calibration" />,
}));

vi.mock('./StepViews', () => ({
  StepViews: () => <div data-testid="step-views" />,
}));

vi.mock('./StepLayout', () => ({
  StepLayout: () => <div data-testid="step-layout" />,
}));

vi.mock('./StepReview', () => ({
  StepReview: () => <div data-testid="step-review">Review your plan</div>,
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return {
    ...actual,
    WizardShell: ({
      children,
      summary,
    }: {
      children: React.ReactNode;
      summary?: React.ReactNode;
    }) => (
      <div data-testid="wizard-shell">
        <div data-testid="wizard-summary">{summary}</div>
        <div data-testid="wizard-content">{children}</div>
      </div>
    ),
    Btn: ({
      children,
      onClick,
      disabled,
      'data-testid': testid,
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      'data-testid'?: string;
    }) => (
      <button onClick={onClick} disabled={disabled} data-testid={testid}>
        {children}
      </button>
    ),
  };
});

import type React from 'react';
import { WizardPage } from './WizardPage';

const EXISTING_PROJECT = {
  id: 'proj-existing',
  name: 'Existing Project',
  tool: 'PixInsight' as const,
  lifecycle: 'active' as const,
  path: 'projects/existing',
  notes: null,
  channelDrift: false,
  sourceCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  blockedReasonKind: null,
  blockedReasonNote: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('alm-project-wizard-draft');
  mockListProjects.mockResolvedValue({
    status: 'ok',
    data: [EXISTING_PROJECT],
  });
  mockSessionsList.mockResolvedValue({ status: 'ok', data: [] });
});

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WizardPage />
    </QueryClientProvider>,
  );
}

async function advanceToReview(nameValue: string) {
  const nameInput = screen.getByLabelText('Project name');
  fireEvent.change(nameInput, { target: { value: nameValue } });

  fireEvent.click(screen.getByText(/Next: sources/i));
  await waitFor(() =>
    expect(screen.getByTestId('step-sources')).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText('Select sessions'));
  await waitFor(() =>
    expect(screen.getByTestId('step-sources')).toBeInTheDocument(),
  );

  fireEvent.click(screen.getByText(/Next: calibration/i));
  await waitFor(() =>
    expect(screen.getByTestId('step-calibration')).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText(/Next: source views/i));
  await waitFor(() =>
    expect(screen.getByTestId('step-views')).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText(/Next: naming/i));
  await waitFor(() =>
    expect(screen.getByTestId('step-layout')).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText(/Next: review/i));
  await waitFor(() =>
    expect(screen.getByTestId('step-review')).toBeInTheDocument(),
  );
}

describe('WizardPage duplicate-name banner persistence (backlog defect)', () => {
  it('keeps the duplicate-name banner visible after StepName remounts on step 0, and only clears it once the name actually changes', async () => {
    renderWizard();
    // Same name, different case — the pre-check is case-insensitive.
    await advanceToReview('existing project');

    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-create-btn'));
    });

    // Routed back to step 0 with the banner visible.
    await waitFor(() => {
      expect(screen.getByLabelText('Project name')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i);
    });

    // Give any pending microtasks/effects (including StepName's remount
    // resync effect) a chance to run — this is exactly where the bug used to
    // clear the banner without any user action.
    await act(async () => {
      await Promise.resolve();
    });

    // The banner must still be visible — nothing the user did should have
    // cleared it yet.
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i);

    // Now the user actually edits the name to a non-colliding value — this
    // SHOULD clear the banner.
    const nameInput = screen.getByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: 'A Brand New Name' } });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
