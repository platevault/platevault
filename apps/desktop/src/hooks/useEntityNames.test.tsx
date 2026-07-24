// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useEntityNames tests (#809) — the resolver shared by Audit Log,
 * Projects Sources, and the Calibration match panel.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockProjectsGet, mockTargetGet, mockPlansGet, mockInventoryList } =
  vi.hoisted(() => ({
    mockProjectsGet: vi.fn(),
    mockTargetGet: vi.fn(),
    mockPlansGet: vi.fn(),
    mockInventoryList: vi.fn(),
  }));

vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: {
      ...original.commands,
      projectsGet: mockProjectsGet,
      targetGet: mockTargetGet,
      plansGet: mockPlansGet,
      inventoryList: mockInventoryList,
    },
  };
});

import { useEntityNames, entityNameKey } from './useEntityNames';

const NOT_FOUND = {
  status: 'error' as const,
  error: {
    code: 'entity.not_found',
    message: 'not found',
    severity: 'warning',
    retryable: false,
  },
};

function emptyInventory() {
  return {
    status: 'ok' as const,
    data: {
      status: 'ok',
      contractVersion: '1.0',
      requestId: 'req-inventory',
      generatedAt: '2026-01-01T00:00:00Z',
      sources: [],
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectsGet.mockResolvedValue(NOT_FOUND);
  mockTargetGet.mockResolvedValue(NOT_FOUND);
  mockPlansGet.mockResolvedValue(NOT_FOUND);
  mockInventoryList.mockResolvedValue(emptyInventory());
});

describe('useEntityNames', () => {
  it('resolves a known project id via commands.projectsGet', async () => {
    mockProjectsGet.mockResolvedValue({
      status: 'ok',
      data: { id: 'proj-1', name: 'Andromeda Mosaic' },
    });
    const ref = { entityType: 'project', entityId: 'proj-1' };
    const { result } = renderHook(() => useEntityNames([ref]), { wrapper });

    await waitFor(() => {
      expect(result.current.get(entityNameKey(ref))).toBe('Andromeda Mosaic');
    });
  });

  it('resolves a known session id via the inventory-sources query, not a per-id lookup', async () => {
    mockInventoryList.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'ok',
        contractVersion: '1.0',
        requestId: 'req-inventory',
        generatedAt: '2026-01-01T00:00:00Z',
        sources: [
          {
            id: 'src-1',
            path: '/library/src-1',
            kind: 'library',
            state: 'active',
            sessions: [
              {
                id: 'ses-1',
                name: 'M31 – 2026-05-20',
                sourceId: 'src-1',
                frames: 40,
                type: 'light',
                target: 'M31',
                filter: null,
                exposure: null,
              },
            ],
          },
        ],
      },
    });
    const ref = { entityType: 'session', entityId: 'ses-1' };
    const { result } = renderHook(() => useEntityNames([ref]), { wrapper });

    await waitFor(() => {
      expect(result.current.get(entityNameKey(ref))).toBe('M31 – 2026-05-20');
    });
    expect(mockProjectsGet).not.toHaveBeenCalled();
    expect(mockTargetGet).not.toHaveBeenCalled();
    expect(mockPlansGet).not.toHaveBeenCalled();
  });

  it('resolves a known target id via commands.targetGet (gen-3 effectiveLabel)', async () => {
    mockTargetGet.mockResolvedValue({
      status: 'ok',
      data: {
        id: 'tgt-1',
        primaryDesignation: 'NGC 7000',
        effectiveLabel: 'North America Nebula',
        displayAlias: 'North America Nebula',
        objectType: 'emission_nebula',
        raDeg: 314.75,
        decDeg: 44.52,
        simbadOid: null,
        source: 'resolved',
        aliases: [],
      },
    });
    const ref = { entityType: 'target', entityId: 'tgt-1' };
    const { result } = renderHook(() => useEntityNames([ref]), { wrapper });

    await waitFor(() => {
      expect(result.current.get(entityNameKey(ref))).toBe(
        'North America Nebula',
      );
    });
    expect(mockTargetGet).toHaveBeenCalledWith({ targetId: 'tgt-1' });
  });

  it('falls back (no entry in the map) for an id that genuinely fails to resolve', async () => {
    const ref = { entityType: 'target', entityId: 'tgt-missing' };
    const { result } = renderHook(() => useEntityNames([ref]), { wrapper });

    await waitFor(() =>
      expect(mockTargetGet).toHaveBeenCalledWith({ targetId: 'tgt-missing' }),
    );
    expect(result.current.get(entityNameKey(ref))).toBeUndefined();
  });

  it('falls back for an entity type with no known lookup (e.g. settings)', () => {
    const ref = { entityType: 'settings', entityId: 'settings-1' };
    const { result } = renderHook(() => useEntityNames([ref]), { wrapper });

    expect(result.current.get(entityNameKey(ref))).toBeUndefined();
    expect(mockProjectsGet).not.toHaveBeenCalled();
    expect(mockTargetGet).not.toHaveBeenCalled();
    expect(mockPlansGet).not.toHaveBeenCalled();
  });
});
