/// <reference types="@testing-library/jest-dom" />
/**
 * EditProjectPane tests — spec 008 US3 + US4.
 *
 * Tests:
 * 1. Renders with current project values.
 * 2. Tool field is disabled when lifecycle is tool-locked.
 * 3. All fields disabled when archived.
 * 4. Save calls useUpdateProject with changed fields.
 * 5. Channel drift banner renders when hasNewSources is true.
 * 6. Re-infer button calls useReinferChannels.
 * 7. Dismiss button calls useDismissChannelDrift.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdateProject, mockReinferChannels, mockDismissDrift } = vi.hoisted(() => ({
  mockUpdateProject: vi.fn(),
  mockReinferChannels: vi.fn(),
  mockDismissDrift: vi.fn(),
}));

vi.mock('@/features/projects/store', () => ({
  useUpdateProject: mockUpdateProject,
  useReinferChannels: mockReinferChannels,
  useDismissChannelDrift: mockDismissDrift,
  useCreateProject: vi.fn(),
  useAddProjectSource: vi.fn(),
  useRemoveProjectSource: vi.fn(),
  useProjects: () => ({ data: [], loading: false }),
  useProjectDetail: () => ({ data: undefined, loading: false }),
  projectListStore: { subscribe: vi.fn(), getSnapshot: vi.fn(), fetch: vi.fn(), invalidate: vi.fn() },
  projectDetailStore: { get: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn() },
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

vi.stubEnv('VITE_USE_MOCKS', 'true');

import { EditProjectPane } from './EditProjectPane';
import type { ProjectDetailDto } from '@/bindings/index';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<ProjectDetailDto> = {}): ProjectDetailDto {
  return {
    id: 'proj-001',
    name: 'NGC 7000 NB',
    tool: 'PixInsight',
    lifecycle: 'ready',
    path: 'projects/NGC7000_NB',
    channelDrift: { hasNewSources: false, suggestedAction: 'dismiss' },
    sources: [],
    channels: [
      { label: 'Ha', source: 'inferred', addedAt: '2026-06-01T00:00:00Z' },
      { label: 'OIII', source: 'inferred', addedAt: '2026-06-01T00:00:00Z' },
    ],
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EditProjectPane', () => {
  beforeEach(() => {
    mockUpdateProject.mockReset();
    mockReinferChannels.mockReset();
    mockDismissDrift.mockReset();
    mockUpdateProject.mockResolvedValue({ projectId: 'proj-001', fieldsUpdated: ['name'], auditId: 'a', updatedAt: new Date().toISOString() });
    mockReinferChannels.mockResolvedValue({ projectId: 'proj-001', channels: [], auditId: 'a', updatedAt: new Date().toISOString() });
    mockDismissDrift.mockResolvedValue({ projectId: 'proj-001', auditId: 'a', dismissedAt: new Date().toISOString() });
  });

  it('renders with current project name', () => {
    render(<EditProjectPane project={makeProject()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('NGC 7000 NB')).toBeInTheDocument();
  });

  it('renders inferred channels with Auto tag', () => {
    render(<EditProjectPane project={makeProject()} onClose={vi.fn()} />);
    expect(screen.getAllByTitle(/Auto-inferred/i).length).toBe(2);
  });

  it('disables tool select when lifecycle is tool-locked', () => {
    render(
      <EditProjectPane project={makeProject({ lifecycle: 'prepared' })} onClose={vi.fn()} />,
    );
    const toolSelect = screen.getByRole('combobox', { name: /processing tool/i });
    expect(toolSelect).toBeDisabled();
  });

  it('shows lock notice for tool-locked lifecycle', () => {
    render(
      <EditProjectPane project={makeProject({ lifecycle: 'processing' })} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/tool is locked/i)).toBeInTheDocument();
  });

  it('disables all fields when archived', () => {
    render(
      <EditProjectPane project={makeProject({ lifecycle: 'archived' })} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText(/project name/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByText(/archived.*read-only/i)).toBeInTheDocument();
  });

  it('calls useUpdateProject on save with changed name', async () => {
    render(<EditProjectPane project={makeProject()} onClose={vi.fn()} />);
    const nameInput = screen.getByLabelText(/project name/i);
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    await waitFor(() => {
      expect(mockUpdateProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Name', projectId: 'proj-001' }),
      );
    });
  });

  it('shows drift banner when hasNewSources is true', () => {
    render(
      <EditProjectPane
        project={makeProject({ channelDrift: { hasNewSources: true, suggestedAction: 're_infer' } })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/new sources.*added/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-infer channels/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('calls useReinferChannels when Re-infer is clicked', async () => {
    render(
      <EditProjectPane
        project={makeProject({ channelDrift: { hasNewSources: true, suggestedAction: 're_infer' } })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /re-infer channels/i }));
    });
    await waitFor(() => {
      expect(mockReinferChannels).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-001' }),
      );
    });
  });

  it('calls useDismissChannelDrift when Dismiss is clicked', async () => {
    render(
      <EditProjectPane
        project={makeProject({ channelDrift: { hasNewSources: true, suggestedAction: 're_infer' } })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    });
    await waitFor(() => {
      expect(mockDismissDrift).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-001' }),
      );
    });
  });
});
