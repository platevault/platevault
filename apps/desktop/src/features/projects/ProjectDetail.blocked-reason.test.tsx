/// <reference types="@testing-library/jest-dom" />
/**
 * T047 — BlockedBanner shows the typed `kind` from project_health DTO,
 * NOT the hardcoded `{ kind: 'user' }` value (FR-020).
 *
 * Verifies that:
 * 1. When `blockedReasonKind = 'source_missing'`, the banner shows
 *    "Source missing: ..." with the inventoryId from `blockedReasonNote`.
 * 2. When `blockedReasonKind = 'tool_unconfigured'`, the banner shows
 *    "Tool path not configured: ...".
 * 3. When `blockedReasonKind = 'user'` and a note is present, the banner
 *    shows the note text.
 * 4. When `blockedReasonKind` is absent (legacy / null), falls back to a
 *    generic user message — NOT the old hardcoded "Project is blocked" text.
 * 5. The resolve edge for `source_missing` is `setup_incomplete` (not `ready`).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    useProjectDetail: vi.fn(),
    callTransitionLifecycle: vi.fn(),
    callReinferChannels: vi.fn(),
    callDismissChannelDrift: vi.fn(),
  };
});

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
}));

// Archive plan generation + review overlay have dedicated coverage in
// ProjectDetail.archive-plan.test.tsx; stub them here so this file's
// unrelated assertions don't need a QueryClientProvider.
vi.mock('@/features/archive/store', () => ({
  useGenerateArchivePlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/plans/PlanReviewOverlay', () => ({
  PlanReviewOverlay: () => null,
}));

import { ProjectDetailContent } from './ProjectDetail';
import * as store from './store';
import type { ProjectDetailDto } from '@/bindings/index';

const baseProject: ProjectDetailDto = {
  id: 'proj-blocked-001',
  name: 'NGC 7293 Blocked',
  tool: 'PixInsight',
  lifecycle: 'blocked',
  path: 'projects/NGC7293',
  notes: null,
  channelDrift: { hasNewSources: false, suggestedAction: 'dismiss' },
  sources: [],
  channels: [],
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-10T00:00:00Z',
};

function setupStore(overrides: Partial<ProjectDetailDto> = {}) {
  vi.mocked(store.useProjectDetail).mockReturnValue({
    data: { ...baseProject, ...overrides },
    loading: false,
    error: undefined,
  });
}

describe('T047: BlockedBanner typed reason from project_health DTO (FR-020)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows source_missing message when blockedReasonKind=source_missing and note contains inventoryId', () => {
    setupStore({
      lifecycle: 'blocked',
      blockedReasonKind: 'source_missing',
      blockedReasonNote: 'Source missing: inv-abc-999',
    });
    render(<ProjectDetailContent projectId="proj-blocked-001" />);

    const msg = screen.getByTestId('blocked-reason-message');
    expect(msg).toHaveTextContent('Source missing: inv-abc-999');
    // Must NOT show the old hardcoded message
    expect(msg).not.toHaveTextContent('Project is blocked. Resolve to continue.');
  });

  it('shows tool_unconfigured message when blockedReasonKind=tool_unconfigured', () => {
    setupStore({
      lifecycle: 'blocked',
      blockedReasonKind: 'tool_unconfigured',
      blockedReasonNote: 'Tool path not configured: Siril',
    });
    render(<ProjectDetailContent projectId="proj-blocked-001" />);

    const msg = screen.getByTestId('blocked-reason-message');
    expect(msg).toHaveTextContent('Tool path not configured: Siril');
  });

  it('shows user reason note when blockedReasonKind=user', () => {
    setupStore({
      lifecycle: 'blocked',
      blockedReasonKind: 'user',
      blockedReasonNote: 'Manual block by user',
    });
    render(<ProjectDetailContent projectId="proj-blocked-001" />);

    const msg = screen.getByTestId('blocked-reason-message');
    expect(msg).toHaveTextContent('Manual block by user');
    // Must NOT show the hardcoded fallback
    expect(msg).not.toHaveTextContent('Project is blocked. Resolve to continue.');
  });

  it('falls back to a generic message when blockedReasonKind is absent', () => {
    setupStore({
      lifecycle: 'blocked',
      // No blockedReasonKind or blockedReasonNote
    });
    render(<ProjectDetailContent projectId="proj-blocked-001" />);

    // Banner should still render
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('blocked-reason-message')).toBeInTheDocument();
    // The generic fallback must NOT be the old literal "Project is blocked. Resolve to continue."
    // — it should be a cleaner generic message
    expect(screen.getByTestId('blocked-reason-message')).not.toHaveTextContent(
      'Project is blocked. Resolve to continue.',
    );
  });

  it('routes source_missing resolve to setup_incomplete edge', async () => {
    setupStore({
      lifecycle: 'blocked',
      blockedReasonKind: 'source_missing',
      blockedReasonNote: 'Source missing: inv-xyz',
    });
    vi.mocked(store.callTransitionLifecycle).mockResolvedValue({
      status: 'success',
      contractVersion: '2.0.0',
      requestId: 'req-x',
      newState: 'setup_incomplete',
    });

    render(<ProjectDetailContent projectId="proj-blocked-001" />);
    fireEvent.click(screen.getByTestId('blocked-resolve-btn'));

    await waitFor(() => {
      expect(store.callTransitionLifecycle).toHaveBeenCalledWith(
        'proj-blocked-001',
        'blocked',
        'setup_incomplete',
        'Resolved blocker',
      );
    });
  });

  it('routes tool_unconfigured resolve to setup_incomplete edge', async () => {
    setupStore({
      lifecycle: 'blocked',
      blockedReasonKind: 'tool_unconfigured',
      blockedReasonNote: 'Tool path not configured: PixInsight',
    });
    vi.mocked(store.callTransitionLifecycle).mockResolvedValue({
      status: 'success',
      contractVersion: '2.0.0',
      requestId: 'req-y',
      newState: 'setup_incomplete',
    });

    render(<ProjectDetailContent projectId="proj-blocked-001" />);
    fireEvent.click(screen.getByTestId('blocked-resolve-btn'));

    await waitFor(() => {
      expect(store.callTransitionLifecycle).toHaveBeenCalledWith(
        'proj-blocked-001',
        'blocked',
        'setup_incomplete',
        'Resolved blocker',
      );
    });
  });
});
