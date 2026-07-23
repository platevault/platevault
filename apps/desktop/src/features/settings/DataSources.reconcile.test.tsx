// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DataSources "Reconcile" flow tests (spec 048 T022 UI gap).
 *
 * `inventory.reconcile.run` had a real backend implementation but zero
 * frontend callers — session/inventory frame counts could only refresh by
 * waiting out the 30s default TanStack Query `staleTime`
 * (`apps/desktop/src/data/queryClient.ts`). This adds the missing manual
 * trigger (raw/calibration roots only — the categories `file_record` rows
 * are populated for) and wires cache invalidation so a completed reconcile
 * is reflected immediately.
 *
 * Verifies:
 * 1. Clicking "Reconcile" on a raw root invokes `inventory_reconcile_run`
 *    with the root's id.
 * 2. On completion, the `sessions` query is invalidated so any mounted
 *    session frame-count view refetches instead of showing stale data.
 * 3. The button is absent for project/inbox roots (no `file_record` rows to
 *    reconcile against).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DataSources } from './DataSources';
import { queryClient } from '@/data/queryClient';
import { queryKeys } from '@/data/queryKeys';
import type { LibraryRoot } from '@/bindings/types';

// `DataSources` invalidates via BOTH the module-level `queryClient` singleton
// (handleReconcile's own `queryClient.invalidateQueries` call) and the
// `useInvalidateInventory()` hook (which reads it via `useQueryClient()`) —
// the tests below spy on the singleton, so the provider must supply that SAME
// instance, not a fresh `new QueryClient()`.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const {
  mockRootsList,
  mockReconcileRun,
  mockSourceProtectionGet,
  mockOverridableKeys,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockReconcileRun: vi.fn(),
  mockSourceProtectionGet: vi.fn(),
  mockOverridableKeys: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inventoryReconcileRun: mockReconcileRun,
    sourceProtectionGet: mockSourceProtectionGet,
    settingsOverridableKeys: mockOverridableKeys,
  },
}));

function makeRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
  return {
    id: 'root-1',
    path: '/astro/raw',
    category: 'raw',
    online: true,
    fileCount: 0,
    lastScanned: null,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  mockSourceProtectionGet.mockResolvedValue({
    status: 'ok',
    data: {
      sourceId: 'root-1',
      level: 'unprotected',
      blockPermanentDelete: false,
      categories: [],
      inheritsDefault: true,
    },
  });
  mockOverridableKeys.mockResolvedValue({
    status: 'ok',
    data: ['defaultProtection'],
  });
});

/** Issue #562: per-source actions live inside the kebab (⋯) menu now. */
function openKebab() {
  fireEvent.click(screen.getByRole('button', { name: /Source actions/i }));
}

describe('DataSources — Reconcile', () => {
  it('calls inventory_reconcile_run with the root id and invalidates both the sessions and inventory queries on completion', async () => {
    mockRootsList.mockResolvedValue({ status: 'ok', data: [makeRoot()] });
    mockReconcileRun.mockResolvedValue({
      status: 'ok',
      data: {
        scanned: 3,
        present: 2,
        newlyMissing: 1,
        recovered: 0,
        sizeBackfilled: 0,
        progressPct: 100,
      },
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reconcile$/i }));

    await waitFor(() => {
      expect(mockReconcileRun).toHaveBeenCalledWith({
        rootId: 'root-1',
        reason: 'on_demand',
      });
    });
    // Both readers of frame counts need invalidating: `SessionSourcePicker`
    // (backed by `sessions.all()`) and the Sessions/Inventory page's own
    // `useInventorySources` query (backed by the `["inventory"]` prefix,
    // the same key `useInvalidateInventory()` invalidates elsewhere).
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.sessions.all() }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['inventory'] }),
      );
    });
  });

  it('shows a disabled "Reconciling…" state while the pass is in flight', async () => {
    mockRootsList.mockResolvedValue({ status: 'ok', data: [makeRoot()] });
    let resolveReconcile: ((value: unknown) => void) | undefined;
    mockReconcileRun.mockReturnValue(
      new Promise((resolve) => {
        resolveReconcile = resolve;
      }),
    );

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reconcile$/i }));

    // The kebab menu stays open across a Reconcile click (unlike other
    // items) so the disabled/relabeled state remains visible.
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /Reconciling/i }),
      ).toBeDisabled();
    });

    resolveReconcile?.({
      status: 'ok',
      data: {
        scanned: 0,
        present: 0,
        newlyMissing: 0,
        recovered: 0,
        sizeBackfilled: 0,
        progressPct: 100,
      },
    });

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /^Reconcile$/i }),
      ).not.toBeDisabled();
    });
  });

  it('does not show a Reconcile menu item for project/inbox roots (no file_record rows to diff)', async () => {
    mockRootsList.mockResolvedValue({
      status: 'ok',
      data: [
        makeRoot({
          id: 'root-2',
          path: '/astro/projects',
          category: 'project',
        }),
      ],
    });

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() =>
      screen.getByText('/astro/projects', { selector: 'code' }),
    );

    openKebab();
    expect(
      screen.queryByRole('menuitem', { name: /^Reconcile$/i }),
    ).not.toBeInTheDocument();
  });
});
