// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectDetail — sources table Integ column + MetricLine pluralization
 * regressions.
 *
 * 1. #622: the sources table's Integ cell is computed from
 *    `frames * parseExposureSeconds(exposure)`, not a hardcoded dash.
 * 2. #720 FR-006/SC-002: a source row renders as an anchor deep-linking to
 *    the Inventory/Sessions entry (`#/sessions?selected=<inventoryId>`).
 * 3. #793: the MetricLine "sources"/"channels" labels are count-aware (ICU
 *    plural) — singular counts must not show the always-plural literal.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    useProjectDetail: vi.fn(),
    useSessionNames: vi.fn(() => new Map()),
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

describe('ProjectDetail — sources Integ cell (#622)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes Integ from frames * parsed exposure seconds (54 * 120s = 1.8h)', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'inv-001',
          name: 'NGC 7000 Ha 2024-11',
          frames: 54,
          filter: 'Ha',
          exposure: '120s',
          linkedAt: '2026-05-01T10:05:00Z',
          role: null,
          selection: null,
        },
      ],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    expect(screen.getByText('1.8h')).toBeInTheDocument();
  });

  it('degrades to 0 (—) for an unparseable exposure snapshot rather than throwing', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'inv-002',
          name: 'Bad exposure source',
          frames: 10,
          filter: 'OIII',
          exposure: 'n/a',
          linkedAt: '2026-05-01T10:05:00Z',
          role: null,
          selection: null,
        },
      ],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    expect(
      screen.getByTestId('project-source-link-inv-002'),
    ).toBeInTheDocument();
    // The className is shared by the column's <th> and its <td> (Table
    // component); the body cell is the last match.
    const integCells = document.querySelectorAll(
      'td.alm-project-detail__integ-cell',
    );
    expect(integCells).toHaveLength(1);
    expect(integCells[0]).toHaveTextContent('—');
  });
});

describe('ProjectDetail — source row click-through (#720 FR-006/SC-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the source name as a link to the Inventory/Sessions entry', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'inv-001',
          name: 'NGC 7000 Ha 2024-11',
          frames: 54,
          filter: 'Ha',
          exposure: '120s',
          linkedAt: '2026-05-01T10:05:00Z',
          role: null,
          selection: null,
        },
      ],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    const link = screen.getByTestId('project-source-link-inv-001');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '#/sessions?selected=inv-001');
    expect(link).toHaveTextContent('NGC 7000 Ha 2024-11');
  });
});

describe('ProjectDetail — MetricLine pluralization (#793)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows singular "source" (not "sources") for a project with exactly one source', () => {
    setupStore({
      sources: [
        {
          inventoryId: 'inv-001',
          name: 'NGC 7000 Ha 2024-11',
          frames: 54,
          filter: 'Ha',
          exposure: '120s',
          linkedAt: '2026-05-01T10:05:00Z',
          role: null,
          selection: null,
        },
      ],
      channels: [],
    });
    render(<ProjectDetailContent projectId="proj-m31" />);
    // MetricLine order (ProjectDetail.tsx): integration, sources, channels, tool.
    const metrics = document.querySelectorAll('.alm-metricline__m');
    const sourcesMetric = metrics[1];
    expect(sourcesMetric.querySelector('b')).toHaveTextContent('1');
    expect(sourcesMetric.querySelector('span:not(b)')).toHaveTextContent(
      'source',
    );
    expect(sourcesMetric.querySelector('span:not(b)')).not.toHaveTextContent(
      'sources',
    );
  });

  it('shows plural "channels" for a project with zero channels', () => {
    setupStore({ sources: [], channels: [] });
    render(<ProjectDetailContent projectId="proj-m31" />);
    const metrics = document.querySelectorAll('.alm-metricline__m');
    const channelsMetric = metrics[2];
    expect(channelsMetric.querySelector('b')).toHaveTextContent('0');
    expect(channelsMetric.querySelector('span:not(b)')).toHaveTextContent(
      'channels',
    );
  });
});
