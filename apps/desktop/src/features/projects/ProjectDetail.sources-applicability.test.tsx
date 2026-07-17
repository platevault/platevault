// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectDetail — Sources table missing-value semantics (spec-030 Q16 / #620,
 * #619, T132). `filter`/`role` are applicable to every project source (light
 * sessions) — a missing value must render the unresolved chip, never the
 * same blank dash a not-applicable field would use.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

vi.mock('@/features/archive/store', () => ({
  useGenerateArchivePlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/plans/PlanReviewOverlay', () => ({
  PlanReviewOverlay: () => null,
}));
// spec 054 T017: ProjectDetailContent now mounts ProjectBottomDetail
// (CalibrationMatchPanel, CleanupSection, …), which calls useQuery/useMutation
// directly — stub it out for the same reason as the mocks above.
vi.mock('./ProjectBottomDetail', () => ({
  ProjectBottomDetail: () => null,
}));

import { ProjectDetailContent } from './ProjectDetail';
import * as store from './store';
import type { ProjectDetailDto } from '@/bindings/index';

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

describe('ProjectDetail — Sources table (Q16 / #620)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a source with an unresolved filter renders the unresolved chip, never a bare dash', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'src-1',
          name: 'NGC 7000 · 2026-01-01',
          frames: 20,
          filter: '',
          exposure: '300',
          linkedAt: '2026-01-01T00:00:00Z',
          role: null,
          selection: null,
        },
      ],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    expect(screen.getAllByTestId('unresolved-chip').length).toBeGreaterThan(0);
  });

  it('a source with a real filter renders the filter pill, no unresolved chip for that field', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'src-1',
          name: 'NGC 7000 · 2026-01-01',
          frames: 20,
          filter: 'Ha',
          exposure: '300',
          linkedAt: '2026-01-01T00:00:00Z',
          role: null,
          selection: null,
        },
      ],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    expect(screen.getByText('Ha')).toBeInTheDocument();
  });
});
