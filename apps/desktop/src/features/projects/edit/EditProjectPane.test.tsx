// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * EditProjectPane tests — spec 008 US3 + US4 + WP-008-C.
 *
 * Tests:
 * 1. Renders with current project values.
 * 2. Tool field is disabled when lifecycle is tool-locked.
 * 3. All fields disabled when archived.
 * 4. Save calls useUpdateProject with changed fields.
 * 5. Channel drift banner renders when hasNewSources is true.
 * 6. Re-infer button calls useReinferChannels.
 * 7. Dismiss button calls useDismissChannelDrift.
 * 8. Sources (WP-008-C): lists current sources, removes a source, surfaces
 *    the last-source confirm gate, adds selected sessions, and maps a
 *    ContractError to its catalog message on failure.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpdateProject,
  mockReinferChannels,
  mockDismissDrift,
  mockAddSource,
  mockRemoveSource,
} = vi.hoisted(() => ({
  mockUpdateProject: vi.fn(),
  mockReinferChannels: vi.fn(),
  mockDismissDrift: vi.fn(),
  mockAddSource: vi.fn(),
  mockRemoveSource: vi.fn(),
}));

vi.mock('@/features/projects/store', () => ({
  callUpdateProject: mockUpdateProject,
  callReinferChannels: mockReinferChannels,
  callDismissChannelDrift: mockDismissDrift,
  callCreateProject: vi.fn(),
  callAddProjectSource: mockAddSource,
  callRemoveProjectSource: mockRemoveSource,
  useProjects: () => ({ data: [], loading: false }),
  useProjectDetail: () => ({ data: undefined, loading: false }),
  useSessionNames: () => new Map(),
  projectListStore: {
    subscribe: vi.fn(),
    getSnapshot: vi.fn(),
    fetch: vi.fn(),
    invalidate: vi.fn(),
  },
  projectDetailStore: {
    get: vi.fn(),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  },
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

// The shared session picker (WP-008-C) fetches sessions via react-query; stub
// it the same way WizardPage.test.tsx stubs StepSources, so EditProjectPane's
// own add/remove logic is exercised without needing a QueryClientProvider or
// IPC-level session fixtures here.
vi.mock('@/features/projects/SessionSourcePicker', () => ({
  SessionSourcePicker: ({
    selectedSessionIds,
    onChange,
  }: {
    selectedSessionIds: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <div data-testid="session-source-picker">
      <button
        type="button"
        onClick={() => onChange([...selectedSessionIds, 'sess-candidate'])}
      >
        Select sess-candidate
      </button>
    </div>
  ),
}));

vi.stubEnv('VITE_USE_MOCKS', 'true');

import { EditProjectPane } from './EditProjectPane';
import type { ProjectDetailDto, ProjectSourceDto } from '@/bindings/index';

function makeSource(
  overrides: Partial<ProjectSourceDto> = {},
): ProjectSourceDto {
  return {
    inventoryId: 'sess-001',
    name: 'M31 / Ha / 2026-06-01',
    frames: 20,
    filter: 'Ha',
    exposure: '300s',
    linkedAt: '2026-06-01T00:00:00Z',
    role: null,
    selection: null,
    ...overrides,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProject(
  overrides: Partial<ProjectDetailDto> = {},
): ProjectDetailDto {
  return {
    id: 'proj-001',
    name: 'NGC 7000 NB',
    tool: 'PixInsight',
    lifecycle: 'ready',
    path: 'projects/NGC7000_NB',
    channelDrift: { hasNewSources: false, suggestedAction: 'dismiss' },
    sources: [],
    channels: [
      {
        label: 'Ha',
        source: 'inferred',
        addedAt: '2026-06-01T00:00:00Z',
        subFrames: 0,
        totalIntegrationS: 0,
      },
      {
        label: 'OIII',
        source: 'inferred',
        addedAt: '2026-06-01T00:00:00Z',
        subFrames: 0,
        totalIntegrationS: 0,
      },
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
    mockAddSource.mockReset();
    mockRemoveSource.mockReset();
    mockUpdateProject.mockResolvedValue({
      projectId: 'proj-001',
      fieldsUpdated: ['name'],
      auditId: 'a',
      updatedAt: new Date().toISOString(),
    });
    mockReinferChannels.mockResolvedValue({
      projectId: 'proj-001',
      channels: [],
      auditId: 'a',
      updatedAt: new Date().toISOString(),
    });
    mockDismissDrift.mockResolvedValue({
      projectId: 'proj-001',
      auditId: 'a',
      dismissedAt: new Date().toISOString(),
    });
    mockAddSource.mockResolvedValue({
      projectId: 'proj-001',
      sourceAdded: makeSource({ inventoryId: 'sess-candidate' }),
      channels: [],
      auditId: 'a',
      linkedAt: new Date().toISOString(),
      newLifecycle: null,
    });
    mockRemoveSource.mockResolvedValue({
      projectId: 'proj-001',
      removedSourceId: 'sess-001',
      auditId: 'a',
      newLifecycle: null,
    });
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
      <EditProjectPane
        project={makeProject({ lifecycle: 'prepared' })}
        onClose={vi.fn()}
      />,
    );
    const toolSelect = screen.getByRole('combobox', {
      name: /processing tool/i,
    });
    expect(toolSelect).toBeDisabled();
  });

  it('shows lock notice for tool-locked lifecycle', () => {
    render(
      <EditProjectPane
        project={makeProject({ lifecycle: 'processing' })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/tool is locked/i)).toBeInTheDocument();
  });

  it('disables all fields when archived', () => {
    render(
      <EditProjectPane
        project={makeProject({ lifecycle: 'archived' })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/project name/i)).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /save/i }),
    ).not.toBeInTheDocument();
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
        project={makeProject({
          channelDrift: { hasNewSources: true, suggestedAction: 're_infer' },
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/new sources.*added/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /re-infer channels/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /dismiss/i }),
    ).toBeInTheDocument();
  });

  it('calls useReinferChannels when Re-infer is clicked', async () => {
    render(
      <EditProjectPane
        project={makeProject({
          channelDrift: { hasNewSources: true, suggestedAction: 're_infer' },
        })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /re-infer channels/i }),
      );
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
        project={makeProject({
          channelDrift: { hasNewSources: true, suggestedAction: 're_infer' },
        })}
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

// ── Sources (WP-008-C) ───────────────────────────────────────────────────────

describe('EditProjectPane sources (WP-008-C)', () => {
  beforeEach(() => {
    mockAddSource.mockReset();
    mockRemoveSource.mockReset();
    mockAddSource.mockResolvedValue({
      projectId: 'proj-001',
      sourceAdded: makeSource({ inventoryId: 'sess-candidate' }),
      channels: [],
      auditId: 'a',
      linkedAt: new Date().toISOString(),
      newLifecycle: null,
    });
    mockRemoveSource.mockResolvedValue({
      projectId: 'proj-001',
      removedSourceId: 'sess-001',
      auditId: 'a',
      newLifecycle: null,
    });
  });

  it('lists current sources with a Remove affordance', () => {
    render(
      <EditProjectPane
        project={makeProject({
          sources: [makeSource({ inventoryId: 'sess-001', name: 'M31 / Ha' })],
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('M31 / Ha')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^remove$/i }),
    ).toBeInTheDocument();
  });

  it('shows an empty hint when no sources are linked', () => {
    render(
      <EditProjectPane
        project={makeProject({ sources: [] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/no sources linked yet/i)).toBeInTheDocument();
  });

  it('removes a source when Remove is clicked', async () => {
    render(
      <EditProjectPane
        project={makeProject({
          sources: [makeSource({ inventoryId: 'sess-001' })],
        })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });
    await waitFor(() => {
      expect(mockRemoveSource).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-001',
          projectSourceId: 'sess-001',
          confirmLastSource: false,
        }),
      );
    });
  });

  it('surfaces the last-source confirm gate and retries with confirmLastSource=true', async () => {
    mockRemoveSource.mockRejectedValueOnce({
      code: 'lifecycle.last_confirmed_source',
      message: 'backend diagnostic',
      severity: 'blocking',
      retryable: false,
    });
    render(
      <EditProjectPane
        project={makeProject({
          sources: [makeSource({ inventoryId: 'sess-001' })],
        })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });
    await waitFor(() => {
      expect(
        screen.getByText(/can't remove the last confirmed source/i),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });
    await waitFor(() => {
      expect(mockRemoveSource).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectSourceId: 'sess-001',
          confirmLastSource: true,
        }),
      );
    });
  });

  it('maps a non-confirm removal error to its catalog message', async () => {
    mockRemoveSource.mockRejectedValueOnce({
      code: 'source.not_found',
      message: 'backend diagnostic',
      severity: 'blocking',
      retryable: false,
    });
    render(
      <EditProjectPane
        project={makeProject({
          sources: [makeSource({ inventoryId: 'sess-001' })],
        })}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
    });
    // Never the raw backend diagnostic string (spec 046 FR-009).
    expect(screen.queryByText(/backend diagnostic/i)).not.toBeInTheDocument();
  });

  it('reveals the shared session picker and adds the selected sessions', async () => {
    render(
      <EditProjectPane
        project={makeProject({ sources: [] })}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add sources/i }));
    expect(screen.getByTestId('session-source-picker')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /select sess-candidate/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));
    });
    await waitFor(() => {
      expect(mockAddSource).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-001',
          inventorySessionId: 'sess-candidate',
        }),
      );
    });
  });

  it('maps an add-source error to its catalog message and keeps the picker open', async () => {
    mockAddSource.mockRejectedValueOnce({
      code: 'source.already.linked',
      message: 'backend diagnostic',
      severity: 'blocking',
      retryable: false,
    });
    render(
      <EditProjectPane
        project={makeProject({ sources: [] })}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add sources/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /select sess-candidate/i }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add 1 selected/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('session-source-picker')).toBeInTheDocument();
  });

  it('hides the add-sources toggle and disables Remove when the project is archived', () => {
    render(
      <EditProjectPane
        project={makeProject({
          lifecycle: 'archived',
          sources: [makeSource({ inventoryId: 'sess-001' })],
        })}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /add sources/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeDisabled();
  });
});
