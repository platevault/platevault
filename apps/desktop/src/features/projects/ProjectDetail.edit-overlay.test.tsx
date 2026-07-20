// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectDetail — Edit pane dialog chrome (#660).
 *
 * The edit pane used to be a bare `position:absolute; inset:0` div with no
 * positioned ancestor, so it sized against the viewport and hid the whole app
 * shell, with no dialog role, no Escape and no focus trap. It now renders
 * through the shared `Modal`, which supplies all four. These assert the
 * user-visible contract (Journey 16), not the CSS.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // ProjectLifecycleStepper's History section (#833) falls back to this
    // route search param when its (optional) projectId prop isn't wired;
    // unrelated to this file's assertions, so a static empty selection is
    // enough.
    useSearch: () => ({ selected: undefined, lifecycle: undefined }),
    // The tool-launch toast's "Configure path" action navigates through the
    // router and the tool-not-configured hint is a real `Link` — neither
    // works against the spread-in real implementations without a router
    // context (same reasoning as the other ProjectDetail suites).
    useNavigate: () => vi.fn(),
    Link: (await import('@/test/router-link-stub')).LinkStub,
  };
});

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    useProjectDetail: vi.fn(),
    useSessionNames: vi.fn(() => new Map()),
    useTransitionLifecycle: vi.fn(),
    useReinferChannels: vi.fn(),
    useDismissChannelDrift: vi.fn(),
    useProjectHistory: vi.fn(() => ({
      data: [],
      loading: false,
      error: undefined,
    })),
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

function renderDetail() {
  vi.mocked(store.useProjectDetail).mockReturnValue({
    data: BASE_PROJECT,
    loading: false,
    error: undefined,
  });
  render(<ProjectDetailContent projectId="proj-m31" />);
}

async function openEditPane() {
  fireEvent.click(screen.getByRole('button', { name: /edit/i }));
  return await screen.findByRole('dialog');
}

describe('ProjectDetail — edit pane dialog chrome (#660)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is closed until Edit is pressed', () => {
    renderDetail();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the edit pane as a dialog with an accessible name', async () => {
    renderDetail();
    const dialog = await openEditPane();
    expect(dialog).toHaveAccessibleName('Edit project');
    // The pane's own form is inside the dialog, not loose in the page.
    expect(dialog).toContainElement(screen.getByLabelText(/name/i));
  });

  it('closes on Escape', async () => {
    renderDetail();
    await openEditPane();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('traps focus: the detail pane behind it becomes unreachable, then reachable again on close', async () => {
    renderDetail();
    await openEditPane();

    // The Edit button that opened the dialog is the page behind; while the
    // dialog is open base-ui marks it inert, so it leaves the a11y tree.
    // This is exactly what the old bare-div overlay failed to do.
    expect(
      screen.queryByRole('button', { name: /edit/i }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });
  });
});
