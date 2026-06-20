/// <reference types="@testing-library/jest-dom" />
/**
 * CreateProjectDialog tests — spec 008 US1.
 *
 * Tests:
 * 1. Renders with tool radio group defaulting to PixInsight.
 * 2. Submit disabled when tool is not selected (though default pre-selects).
 * 3. Shows validation error for empty name.
 * 4. Shows validation error for empty path.
 * 5. Calls projects.create with correct payload on valid submit.
 * 6. Shows server error code on command failure.
 * 7. Calls onSuccess with result on success.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock API commands ──────────────────────────────────────────────────────

const { mockCreateProject, mockListProjects, mockSearchTargets, mockResolveTarget } = vi.hoisted(() => ({
  mockCreateProject: vi.fn(),
  mockListProjects: vi.fn(),
  mockSearchTargets: vi.fn(),
  mockResolveTarget: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  createProject: mockCreateProject,
  listProjects008: mockListProjects,
  updateProject: vi.fn(),
  addProjectSource: vi.fn(),
  removeProjectSource: vi.fn(),
  reinferProjectChannels: vi.fn(),
  dismissProjectChannelDrift: vi.fn(),
  getProject008: vi.fn(),
  // TargetSearch (spec 035) is embedded in the dialog.
  searchTargets: mockSearchTargets,
  resolveTarget: mockResolveTarget,
  TARGET_SEARCH_CONTRACT_VERSION: '1.0',
}));

// Mock the store's useCreateProject so it calls our mock
vi.mock('@/features/projects/store', () => ({
  callCreateProject: (req: Record<string, unknown>) => mockCreateProject(req),
  callUpdateProject: vi.fn(),
  callAddProjectSource: vi.fn(),
  callRemoveProjectSource: vi.fn(),
  callReinferChannels: vi.fn(),
  callDismissChannelDrift: vi.fn(),
  useProjects: () => ({ data: [], loading: false, error: undefined }),
  useProjectDetail: () => ({ data: undefined, loading: false, error: undefined }),
  projectListStore: { subscribe: vi.fn(), getSnapshot: vi.fn(() => ({ data: [], loading: false, error: undefined })), fetch: vi.fn(), invalidate: vi.fn() },
  projectDetailStore: { get: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn() },
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

vi.stubEnv('VITE_USE_MOCKS', 'true');

// ── Import under test ──────────────────────────────────────────────────────

import { CreateProjectDialog } from './CreateProjectDialog';

// ── Helpers ────────────────────────────────────────────────────────────────

const _noop = () => {};

function renderDialog(open = true) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <CreateProjectDialog open={open} onClose={onClose} onSuccess={onSuccess} />,
  );
  return { onClose, onSuccess };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CreateProjectDialog', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockListProjects.mockResolvedValue([]);
    mockSearchTargets.mockReset();
    mockResolveTarget.mockReset();
    // Default: TargetSearch finds nothing / resolves nothing (no network).
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveTarget.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      status: 'unresolved',
      target: null,
      unresolvedReason: 'offline',
      error: null,
    });
  });

  it('renders the dialog when open', () => {
    renderDialog();
    expect(screen.getByText('New project')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog(false);
    expect(screen.queryByText('New project')).not.toBeInTheDocument();
  });

  it('shows PixInsight as the default selected tool', () => {
    renderDialog();
    const piBtn = screen.getByRole('button', { name: /PixInsight/i });
    expect(piBtn).toHaveClass('alm-radio--active');
  });

  it('shows name required error on submit with empty name', async () => {
    mockListProjects.mockResolvedValue([]);
    renderDialog();
    const submit = screen.getByRole('button', { name: /create project/i });
    await act(async () => {
      fireEvent.click(submit);
    });
    // Both name and path errors may show; check name error specifically by id
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('shows path required error on submit with empty path', async () => {
    mockListProjects.mockResolvedValue([]);
    renderDialog();
    const nameInput = screen.getByLabelText(/project name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });
    const submit = screen.getByRole('button', { name: /create project/i });
    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/folder path is required/i);
    });
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('calls onSuccess with result when form submits successfully', async () => {
    mockListProjects.mockResolvedValue([]);
    const successResult = {
      projectId: 'proj-new',
      lifecycle: 'setup_incomplete',
      planId: 'plan-001',
      channels: [],
      auditId: 'audit-001',
      createdAt: '2026-06-01T00:00:00Z',
    };
    mockCreateProject.mockResolvedValue(successResult);

    const { onSuccess } = renderDialog();
    const nameInput = screen.getByLabelText(/project name/i);
    const pathInput = screen.getByLabelText(/folder path/i);

    fireEvent.change(nameInput, { target: { value: 'NGC 7000 NB' } });
    fireEvent.change(pathInput, { target: { value: 'projects/NGC7000_NB' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(successResult);
    });
    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'NGC 7000 NB',
        path: 'projects/NGC7000_NB',
        tool: 'PixInsight',
        // No target selected → canonicalTargetId is null (spec 035 US1 #2).
        canonicalTargetId: null,
      }),
    );
  });

  it('sends the selected target as canonicalTargetId (spec 035 US1)', async () => {
    mockListProjects.mockResolvedValue([]);
    mockCreateProject.mockResolvedValue({
      projectId: 'proj-new',
      lifecycle: 'setup_incomplete',
      planId: 'plan-001',
      channels: [],
      auditId: 'audit-001',
      createdAt: '2026-06-01T00:00:00Z',
    });
    // TargetSearch returns one local suggestion for the typed query.
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [
        {
          targetId: 'tgt-m31',
          primaryDesignation: 'M 31',
          commonName: 'Andromeda Galaxy',
          objectType: 'galaxy',
          matchedAlias: 'Andromeda',
          source: 'seed',
        },
      ],
    });

    renderDialog();

    // Select a target via the embedded TargetSearch typeahead.
    const targetInput = screen.getByRole('combobox', { name: /target/i });
    fireEvent.change(targetInput, { target: { value: 'andromeda' } });
    // Wait past the ~300ms debounce, then flush the search promise.
    const option = await screen.findByRole('option', {}, { timeout: 2000 });
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(option);

    // Fill the required fields and submit.
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'M31 Project' } });
    fireEvent.change(screen.getByLabelText(/folder path/i), { target: { value: 'projects/M31' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    });

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'M31 Project',
          path: 'projects/M31',
          canonicalTargetId: 'tgt-m31',
        }),
      );
    });
  });

  it('shows error message when command returns an error code', async () => {
    mockListProjects.mockResolvedValue([]);
    mockCreateProject.mockRejectedValue('name.duplicate');

    renderDialog();
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'Dupe' } });
    fireEvent.change(screen.getByLabelText(/folder path/i), { target: { value: 'projects/Dupe' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i);
    });
  });
});
