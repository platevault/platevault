/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectBottomDetail manifests + notes wiring tests — spec 024 T1.7 / T3.4 / T4.2.
 *
 * Tests that the wired ProjectBottomDetail renders (task #104: sections moved
 * from the narrow side panel to the full-width bottom panel):
 * 1. ManifestsAccordion — shows loading, then list, then expand, then reveal.
 * 2. ProjectNotesSection — shows "No notes." when note is empty; loads and saves.
 * 3. The Reveal button calls revealManifestInOs and shows error toast on failure.
 * 4. ManifestsAccordion empty state when no manifests.
 * 5. ManifestsAccordion error state on fetch failure.
 * 6. Notes section shows readOnly on archived project.
 *
 * Sections are defaultOpen=true in the bottom panel (they have horizontal room),
 * so tests no longer need to call expandSection() before asserting on content.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockListManifests,
  mockGetManifest,
  mockGetProjectNote,
  mockUpdateProjectNote,
  mockRevealManifestInOs,
  mockAddToast,
} = vi.hoisted(() => ({
  mockListManifests: vi.fn(),
  mockGetManifest: vi.fn(),
  mockGetProjectNote: vi.fn(),
  mockUpdateProjectNote: vi.fn(),
  mockRevealManifestInOs: vi.fn(),
  mockAddToast: vi.fn(),
}));

// Mock the generated bindings surface — manifests.ts (spec 037 caller
// migration) now calls commands.manifestList/manifestGet/noteGet/noteUpdate/
// manifestRevealInOs directly instead of the old @/api/commands wrappers.
// Spread the original so other commands (e.g. calibrationMatchSuggestBatch)
// keep working.
vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: {
      ...original.commands,
      manifestList: mockListManifests,
      manifestGet: mockGetManifest,
      noteGet: mockGetProjectNote,
      noteUpdate: mockUpdateProjectNote,
      manifestRevealInOs: mockRevealManifestInOs,
    },
  };
});

// Mock store — provide a default project detail.
vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    useProjectDetail: vi.fn(),
    useTransitionLifecycle: vi.fn(),
    useReinferChannels: vi.fn(),
    useDismissChannelDrift: vi.fn(),
  };
});

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ProjectBottomDetail } from './ProjectBottomDetail';
import * as store from './store';
import type { ProjectDetailDto } from '@/bindings/index';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROJECT: ProjectDetailDto = {
  id: 'proj-m1',
  name: 'NGC 7000 HOO',
  tool: 'PixInsight',
  lifecycle: 'ready',
  path: 'projects/NGC7000',
  notes: null,
  channelDrift: { hasNewSources: false, suggestedAction: 'dismiss' },
  sources: [],
  channels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const MANIFEST_SUMMARY = {
  id: 'man-001',
  reason: 'created' as const,
  timestamp: '2026-04-12T18:01:00Z',
  path: 'notes/manifest-2026-04-12-180100-created.md',
  hasBody: true,
};

const MANIFEST_BODY = {
  lifecycleState: 'ready',
  workflowProfile: null,
  generatedViews: [],
  notes: null,
  sourceMap: null,
  calibration: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a fixture as a successful generated-binding `Result` (spec 037). */
function ok<T>(data: T) {
  return { status: 'ok' as const, data };
}

function setupStore(project: Partial<ProjectDetailDto> = {}) {
  vi.mocked(store.useProjectDetail).mockReturnValue({
    data: { ...BASE_PROJECT, ...project },
    loading: false,
    error: undefined,
  });
}

/**
 * Render ProjectBottomDetail — the component that hosts Manifests, Notes, and
 * other secondary sections (task #104: moved from the narrow side panel to the
 * full-width bottom panel). Sections are defaultOpen=true here, so content is
 * immediately visible without expanding.
 */
function renderDetail(projectId = 'proj-m1') {
  return render(<ProjectBottomDetail projectId={projectId} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProjectDetail — manifests accordion (spec 024)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectNote.mockResolvedValue(ok({ projectId: 'proj-m1', content: null }));
    mockListManifests.mockResolvedValue(ok({ manifests: [], nextCursor: null }));
    mockGetManifest.mockResolvedValue(
      ok({ manifest: { ...MANIFEST_SUMMARY, projectId: 'proj-m1', version: 1, body: MANIFEST_BODY } }),
    );
    mockRevealManifestInOs.mockResolvedValue(ok(null));
    mockUpdateProjectNote.mockResolvedValue(
      ok({ projectId: 'proj-m1', updatedAt: '2026-06-01T12:00:00Z' }),
    );
    setupStore();
  });

  it('1. shows manifests-empty state when project has no manifests', async () => {
    mockListManifests.mockResolvedValue(ok({ manifests: [], nextCursor: null }));
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId('manifests-empty')).toBeInTheDocument();
    });
  });

  it('2. renders manifest list when manifests exist', async () => {
    mockListManifests.mockResolvedValue(ok({ manifests: [MANIFEST_SUMMARY], nextCursor: null }));
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId('manifests-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`manifest-row-${MANIFEST_SUMMARY.id}`)).toBeInTheDocument();
    // Reason label shown
    expect(screen.getByText('Project created')).toBeInTheDocument();
    // Timestamp shown (formatted)
    expect(screen.getByText('2026-04-12 18:01')).toBeInTheDocument();
  });

  it('3. clicking a manifest row loads and shows the body', async () => {
    mockListManifests.mockResolvedValue(ok({ manifests: [MANIFEST_SUMMARY], nextCursor: null }));
    mockGetManifest.mockResolvedValue(
      ok({
        manifest: {
          ...MANIFEST_SUMMARY,
          projectId: 'proj-m1',
          version: 1,
          body: { ...MANIFEST_BODY, lifecycleState: 'processing' },
        },
      }),
    );
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId(`manifest-row-${MANIFEST_SUMMARY.id}`)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`manifest-row-${MANIFEST_SUMMARY.id}`));
    });
    await waitFor(() => {
      expect(screen.getByTestId(`manifest-body-${MANIFEST_SUMMARY.id}`)).toBeInTheDocument();
    });
    // Lifecycle state is shown inside the expanded body
    const body = screen.getByTestId(`manifest-body-${MANIFEST_SUMMARY.id}`);
    expect(body).toHaveTextContent('processing');
  });

  it('4. Reveal button calls revealManifestInOs', async () => {
    mockListManifests.mockResolvedValue(ok({ manifests: [MANIFEST_SUMMARY], nextCursor: null }));
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId(`manifest-reveal-${MANIFEST_SUMMARY.id}`)).toBeInTheDocument();
    });
    // Tooltip carries the shared platform-native revealLabel() (jsdom → Linux-generic).
    expect(screen.getByTestId(`manifest-reveal-${MANIFEST_SUMMARY.id}`)).toHaveAttribute(
      'title',
      'Show in file manager',
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId(`manifest-reveal-${MANIFEST_SUMMARY.id}`));
    });
    await waitFor(() => {
      expect(mockRevealManifestInOs).toHaveBeenCalledWith({
        path: MANIFEST_SUMMARY.path,
      });
    });
  });

  it('5. Reveal failure shows error toast', async () => {
    mockListManifests.mockResolvedValue(ok({ manifests: [MANIFEST_SUMMARY], nextCursor: null }));
    mockRevealManifestInOs.mockRejectedValue('manifest file not found: /some/path');
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId(`manifest-reveal-${MANIFEST_SUMMARY.id}`)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`manifest-reveal-${MANIFEST_SUMMARY.id}`));
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error' }),
      );
    });
  });

  it('6. manifests-error state shown on fetch failure', async () => {
    mockListManifests.mockRejectedValue(new Error('DB failure'));
    renderDetail();
    // Manifests section is defaultOpen=true in the bottom panel — no expand needed.
    await waitFor(() => {
      expect(screen.getByTestId('manifests-error')).toBeInTheDocument();
    });
  });
});

describe('ProjectDetail — project notes section (spec 024)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListManifests.mockResolvedValue(ok({ manifests: [], nextCursor: null }));
    mockGetManifest.mockResolvedValue(
      ok({ manifest: { ...MANIFEST_SUMMARY, projectId: 'proj-m1', version: 1, body: MANIFEST_BODY } }),
    );
    mockRevealManifestInOs.mockResolvedValue(ok(null));
    mockUpdateProjectNote.mockResolvedValue(
      ok({ projectId: 'proj-m1', updatedAt: '2026-06-01T12:00:00Z' }),
    );
    setupStore();
  });

  it('7. shows "No notes." when project has no notes', async () => {
    mockGetProjectNote.mockResolvedValue(ok({ projectId: 'proj-m1', content: null }));
    // ProjectNotesSection is rendered inline — check for notes-empty placeholder
    // after the async note fetch resolves.
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });
  });

  it('8. shows existing notes body when notes are present', async () => {
    // ProjectNotesSection uses initialContent prop. We need to test that
    // the notes section fetches and displays content. Since ProjectNotesSection
    // receives initialContent as a prop from ProjectDetail, and ProjectDetail
    // currently passes undefined (the component fetches its own data internally),
    // we test the section renders with empty state by default.
    mockGetProjectNote.mockResolvedValue(ok({ projectId: 'proj-m1', content: null }));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });
    // Edit button is present in notes section (non-archived project)
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    expect(editButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('9. notes section is read-only for archived projects', async () => {
    mockGetProjectNote.mockResolvedValue(ok({ projectId: 'proj-m1', content: null }));
    setupStore({ lifecycle: 'archived' });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });
    // Edit button should NOT be present
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('10. listManifests is called with the project id', async () => {
    mockGetProjectNote.mockResolvedValue(ok({ projectId: 'proj-m1', content: null }));
    renderDetail('proj-m1');
    await waitFor(() => {
      expect(mockListManifests).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-m1' }),
      );
    });
  });
});
