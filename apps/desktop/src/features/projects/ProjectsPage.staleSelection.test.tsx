// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectsPage stale-selection gating (#735 item 1).
 *
 * Page-level WIRING, deliberately not hook logic: `use-stale-selection.test.tsx`
 * feeds the hook explicit booleans, so it structurally cannot catch a page that
 * derives `found` from a query result that is still empty because the list IPC
 * has not resolved yet. This is the exact scenario spec 020 US1-AS1/SC-002
 * guarantees ("app reloads → same project selected"): on a cold reload the
 * cache is empty, and the unguarded page cleared the URL before the list
 * arrived.
 *
 * Both directions are asserted so the fix cannot regress into a gate that is
 * simply held open forever.
 */

import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectSummaryDto } from '@/bindings/index';

const projectsState: {
  data: ProjectSummaryDto[] | undefined;
  loading: boolean;
  error: Error | undefined;
} = { data: [], loading: false, error: undefined };

vi.mock('./store', () => ({
  useProjects: () => projectsState,
}));

// The detail panes drag in the whole project stack; the gate under test lives
// on the page, so stubs keep this focused (and cheap).
vi.mock('./ProjectDetail', () => ({
  ProjectDetailContent: () => <div data-testid="project-detail-stub" />,
}));
vi.mock('./ProjectBottomDetail', () => ({
  ProjectBottomDetail: () => <div data-testid="project-bottom-detail-stub" />,
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current, lifecycle: undefined }),
}));

import { ProjectsPage } from './ProjectsPage';

function makeProject(id: string): ProjectSummaryDto {
  return {
    id,
    name: 'NGC 7000 · HOO',
    tool: 'PixInsight',
    lifecycle: 'processing',
    path: 'D:/Astro/Projects/NGC7000',
    notes: null,
    channelDrift: false,
    sourceCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    blockedReasonKind: null,
    blockedReasonNote: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedId.current = undefined;
  projectsState.data = [];
  projectsState.loading = false;
  projectsState.error = undefined;
});

describe('ProjectsPage stale-selection gating (#735)', () => {
  it('keeps a valid ?selected= while the projects query is still loading', () => {
    projectsState.loading = true;
    mockSelectedId.current = 'proj-1';

    render(<ProjectsPage />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still clears a genuinely absent id once the list has settled', () => {
    projectsState.data = [makeProject('proj-other')];
    mockSelectedId.current = 'proj-gone';

    render(<ProjectsPage />);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
    );
  });
});
