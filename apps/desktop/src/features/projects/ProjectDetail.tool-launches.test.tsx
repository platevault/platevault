// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectBottomDetail — Tool Launches accordion mounting (#728).
 *
 * `ToolLaunchesAccordion` was built and unit-tested but never mounted
 * anywhere in the project drawer, so observed artifacts were invisible to
 * users (spec 012 FR-009 / SC-001). Asserts it now renders inside
 * `ProjectBottomDetail` alongside the other secondary sections.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockArtifactList, mockListManifests, mockGetProjectNote } = vi.hoisted(
  () => ({
    mockArtifactList: vi.fn(),
    mockListManifests: vi.fn(),
    mockGetProjectNote: vi.fn(),
  }),
);

vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: {
      ...original.commands,
      artifactList: mockArtifactList,
      manifestList: mockListManifests,
      noteGet: mockGetProjectNote,
    },
  };
});

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

// ── Imports ───────────────────────────────────────────────────────────────────

import { ProjectBottomDetail } from './ProjectBottomDetail';
import * as store from './store';
import type { ProjectDetailDto, ArtifactSummary } from '@/bindings/index';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROJECT: ProjectDetailDto = {
  id: 'proj-tl1',
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

const ARTIFACT: ArtifactSummary = {
  id: 'art-1',
  projectId: 'proj-tl1',
  toolLaunchId: 'tl-1',
  path: 'output/MasterDark.xisf',
  kind: 'master',
  tool: 'pixinsight',
  detectedAt: '2026-06-01T10:00:00Z',
  lastSeenAt: '2026-06-01T10:00:00Z',
  state: 'present',
  classificationConfidence: 0.95,
  classificationSource: 'rule',
  sizeBytes: 2048,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function renderDetail(projectId = 'proj-tl1') {
  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return render(<ProjectBottomDetail projectId={projectId} />, { wrapper });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProjectBottomDetail — Tool Launches accordion (#728)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectNote.mockResolvedValue(
      ok({ projectId: 'proj-tl1', content: null }),
    );
    mockListManifests.mockResolvedValue(
      ok({ manifests: [], nextCursor: null }),
    );
    mockArtifactList.mockResolvedValue(ok({ artifacts: [] }));
    setupStore();
  });

  it('mounts the Tool Launches accordion in the bottom panel', async () => {
    renderDetail();
    await waitFor(() => {
      expect(mockArtifactList).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-tl1' }),
      );
    });
    expect(screen.getByText('Tool Launches')).toBeInTheDocument();
  });

  it('renders an observed artifact grouped under its launch', async () => {
    mockArtifactList.mockResolvedValue(ok({ artifacts: [ARTIFACT] }));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('tool-launches-accordion')).toBeInTheDocument();
    });
    expect(screen.getByText('master')).toBeInTheDocument();
    expect(screen.getByText('MasterDark.xisf')).toBeInTheDocument();
  });

  it('shows the empty state when no artifacts have been observed', async () => {
    mockArtifactList.mockResolvedValue(ok({ artifacts: [] }));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Tool Launches')).toBeInTheDocument();
    });
    expect(
      screen.getByText('No processing artifacts observed yet.'),
    ).toBeInTheDocument();
  });
});
