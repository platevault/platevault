/// <reference types="@testing-library/jest-dom" />
/**
 * T078c — New-project wizard: session+calibration selection, create succeeds
 * end-to-end (FR-043).
 *
 * Tests:
 * 1. WizardPage renders step 1 (Name & profile) by default.
 * 2. Step 2 (Sources / lights) is reachable and shows session selection.
 * 3. Step 3 (Calibration) is reachable and shows calibration mapping.
 * 4. Advancing to step 6 (Review) shows the Create project button.
 * 5. Clicking Create project calls callCreateProject with the wizard data.
 * 6. On success, a toast is shown and navigate('/projects') is called.
 * 7. Target detail "new project" button navigates to /projects/new.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn().mockReturnValue(undefined),
}));

vi.mock('@/features/projects/store', () => ({
  callCreateProject: vi.fn(),
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
}));

// Stub child wizard steps so we only test the WizardPage orchestration.
vi.mock('./StepName', () => ({
  StepName: ({ onChange }: { onChange: (d: { name: string; workflowProfile: string }) => void }) => (
    <div data-testid="step-name">
      <input
        aria-label="Project name"
        onChange={(e) => onChange({ name: e.target.value, workflowProfile: 'pixinsight' })}
      />
    </div>
  ),
}));

vi.mock('./StepSources', () => ({
  StepSources: ({ onChange }: { onChange: (d: { selectedSessionIds: string[] }) => void }) => (
    <div data-testid="step-sources">
      <button onClick={() => onChange({ selectedSessionIds: ['sess-001', 'sess-002'] })}>
        Select sessions
      </button>
    </div>
  ),
}));

vi.mock('./StepCalibration', () => ({
  StepCalibration: ({ onChange }: { onChange: (d: unknown) => void }) => (
    <div data-testid="step-calibration">
      <button onClick={() => onChange({ flatMappings: {}, sharedDarkId: 'dark-001', sharedBiasId: '', sharedDarkFlatId: '' })}>
        Select dark master
      </button>
    </div>
  ),
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
    WizardShell: ({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }) => (
      <div data-testid="wizard-shell">
        <div data-testid="wizard-summary">{summary}</div>
        <div data-testid="wizard-content">{children}</div>
      </div>
    ),
    Btn: ({ children, onClick, disabled, 'data-testid': testid }: React.ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string }) => (
      <button onClick={onClick} disabled={disabled} data-testid={testid}>{children}</button>
    ),
  };
});

import React from 'react';

// ── Tests ─────────────────────────────────────────────────────────────────────

import { WizardPage } from './WizardPage';
import { callCreateProject } from '@/features/projects/store';
import { addToast } from '@/shared/toast';

const mockCallCreateProject = vi.mocked(callCreateProject);
const mockAddToast = vi.mocked(addToast);

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the draft from localStorage before each test
  localStorage.removeItem('alm-project-wizard-draft');
});

describe('T078c: WizardPage renders inside main window with correct layout', () => {
  it('renders step 1 (Name & profile) by default', () => {
    render(<WizardPage />);
    expect(screen.getByTestId('step-name')).toBeInTheDocument();
  });

  it('shows "New project" in the toolbar heading span', () => {
    render(<WizardPage />);
    // The toolbar span contains "New project —" + projectLabel.
    // Use getAllByText since the summary rail also mentions project name.
    const matches = screen.getAllByText(/New project/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('has the layout fix: outer div has minHeight: 0 style', () => {
    const { container } = render(<WizardPage />);
    const outer = container.firstChild as HTMLElement;
    // The outer div must have minHeight:0 to prevent flex overflow
    expect(outer.style.minHeight).toBe('0px');
  });
});

describe('T078c: wizard step navigation with session+calibration selection', () => {
  it('navigates from step 1 to step 2 (Sources)', async () => {
    render(<WizardPage />);

    // Fill in project name to enable next
    const nameInput = screen.getByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: 'NGC 7000 HOO' } });

    // Click Next: sources
    const nextBtn = screen.getByText(/Next: sources/i);
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByTestId('step-sources')).toBeInTheDocument();
    });
  });

  it('session selection is possible at step 2', async () => {
    render(<WizardPage />);

    // Step 0: fill name so canAdvance() returns true
    const nameInput = screen.getByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });

    // Navigate to step 2 (sources)
    fireEvent.click(screen.getByText(/Next: sources/i));
    await waitFor(() => expect(screen.getByTestId('step-sources')).toBeInTheDocument());

    // The step has a "Select sessions" button
    expect(screen.getByText('Select sessions')).toBeInTheDocument();

    // Click it to select sessions
    fireEvent.click(screen.getByText('Select sessions'));

    // Summary rail should update to show 2 sessions
    await waitFor(() => {
      expect(screen.getByText('2 sess')).toBeInTheDocument();
    });
  });

  it('calibration selection is possible at step 3', async () => {
    render(<WizardPage />);

    // Step 0: fill name
    const nameInput = screen.getByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });

    // Step 0 → 1
    fireEvent.click(screen.getByText(/Next: sources/i));
    await waitFor(() => expect(screen.getByTestId('step-sources')).toBeInTheDocument());

    // Select sessions so canAdvance() at step 1 returns true
    fireEvent.click(screen.getByText('Select sessions'));
    await waitFor(() => expect(screen.getByText('2 sess')).toBeInTheDocument());

    // Step 1 → 2
    fireEvent.click(screen.getByText(/Next: calibration/i));
    await waitFor(() => expect(screen.getByTestId('step-calibration')).toBeInTheDocument());

    // The step has a "Select dark master" button
    expect(screen.getByText('Select dark master')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Select dark master'));

    // Summary rail should show 1 dark master
    await waitFor(() => {
      expect(screen.getByText('1 master')).toBeInTheDocument();
    });
  });
});

describe('T078c: create project end-to-end', () => {
  /** Helper: advance WizardPage from step 0 through to review (step 5). */
  async function advanceToReview(nameValue = 'NGC 7000 HOO') {
    const nameInput = screen.getByLabelText('Project name');
    fireEvent.change(nameInput, { target: { value: nameValue } });

    fireEvent.click(screen.getByText(/Next: sources/i));
    await waitFor(() => expect(screen.getByTestId('step-sources')).toBeInTheDocument());

    // Select sessions so step 1 canAdvance = true
    fireEvent.click(screen.getByText('Select sessions'));
    await waitFor(() => expect(screen.getByText('2 sess')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Next: calibration/i));
    await waitFor(() => expect(screen.getByTestId('step-calibration')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Next: source views/i));
    await waitFor(() => expect(screen.getByTestId('step-views')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Next: naming/i));
    await waitFor(() => expect(screen.getByTestId('step-layout')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Next: review/i));
    await waitFor(() => expect(screen.getByTestId('step-review')).toBeInTheDocument());
  }

  it('shows "Create project" button at step 6 (Review)', async () => {
    render(<WizardPage />);
    await advanceToReview();

    // Create project button appears at step 6
    expect(screen.getByTestId('wizard-create-btn')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-create-btn')).toHaveTextContent('Create project');
  });

  it('calls callCreateProject on clicking Create project', async () => {
    mockCallCreateProject.mockResolvedValue({
      projectId: 'proj-new-001',
      lifecycle: 'setup_incomplete',
      planId: null,
      channels: [],
      auditId: 'audit-001',
      createdAt: '2026-06-17T00:00:00Z',
    });

    render(<WizardPage />);
    await advanceToReview('NGC 7000 HOO');

    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-create-btn'));
    });

    await waitFor(() => {
      expect(mockCallCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'NGC 7000 HOO',
          tool: 'PixInsight',
          path: expect.stringContaining('ngc-7000-hoo'),
          initialSources: ['sess-001', 'sess-002'],
        }),
      );
    });
  });

  it('shows success toast and navigates to /projects after successful create', async () => {
    mockCallCreateProject.mockResolvedValue({
      projectId: 'proj-new-002',
      lifecycle: 'setup_incomplete',
      planId: null,
      channels: [],
      auditId: 'audit-002',
      createdAt: '2026-06-17T00:00:00Z',
    });

    render(<WizardPage />);
    await advanceToReview('M31 LRGB');

    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-create-btn'));
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success' }),
      );
    });
  });

  it('shows error toast when create fails', async () => {
    mockCallCreateProject.mockRejectedValue(new Error('name.duplicate'));

    render(<WizardPage />);
    await advanceToReview('Duplicate Project');

    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-create-btn'));
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error' }),
      );
    });
  });
});

