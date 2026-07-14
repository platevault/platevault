// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectDetail canonical-target rail tests — spec 035 US1 #2.
 *
 * Verifies the "Target" rail card:
 * 1. renders primary designation + common name when the project has an
 *    associated canonical target,
 * 2. renders the designation only when no common name exists,
 * 3. is absent when the project has no canonical target.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAddToast } = vi.hoisted(() => ({ mockAddToast: vi.fn() }));

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

// Archive plan generation + review overlay have dedicated coverage in
// ProjectDetail.archive-plan.test.tsx; stub them here so this file's
// unrelated assertions don't need a QueryClientProvider.
vi.mock('@/features/archive/store', () => ({
  useGenerateArchivePlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/plans/PlanReviewOverlay', () => ({
  PlanReviewOverlay: () => null,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ProjectDetailContent } from './ProjectDetail';
import * as store from './store';
import type { ProjectDetailDto } from '@/bindings/index';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROJECT: ProjectDetailDto = {
  id: 'proj-m31',
  name: 'M 31 LRGB',
  tool: 'PixInsight',
  lifecycle: 'ready',
  path: 'projects/M31',
  notes: null,
  channelDrift: { hasNewSources: false, suggestedAction: 'dismiss' },
  sources: [],
  channels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function setupStore(project: Partial<ProjectDetailDto> = {}) {
  vi.mocked(store.useProjectDetail).mockReturnValue({
    data: { ...BASE_PROJECT, ...project },
    loading: false,
    error: undefined,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProjectDetail — canonical target rail (spec 035)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. shows designation + common name when a canonical target is associated', () => {
    setupStore({
      canonicalTarget: {
        id: 'ct-1',
        primaryDesignation: 'M 31',
        commonName: 'Andromeda Galaxy',
      },
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    const card = screen.getByTestId('project-canonical-target');
    expect(card).toHaveTextContent('M 31');
    expect(card).toHaveTextContent('Andromeda Galaxy');
  });

  it('2. shows designation only when no common name exists', () => {
    setupStore({
      canonicalTarget: {
        id: 'ct-2',
        primaryDesignation: 'NGC 7331',
        commonName: null,
      },
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    const card = screen.getByTestId('project-canonical-target');
    expect(card).toHaveTextContent('NGC 7331');
  });

  it('3. omits the target card when no canonical target is associated', () => {
    setupStore({ canonicalTarget: null });
    render(<ProjectDetailContent projectId="proj-m31" />);
    expect(
      screen.queryByTestId('project-canonical-target'),
    ).not.toBeInTheDocument();
  });
});
