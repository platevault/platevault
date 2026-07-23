// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Archive store — restore-plan command routing (#886).
 *
 * `useGenerateRestorePlan`'s mutation fn must route to the entity-specific
 * backend command: `archivePlanGenerateRestore` for a project row,
 * `calibrationMastersArchivePlanGenerateRestore` for a master row — the two
 * generators validate different plan origins (`archive` vs
 * `calibration_master_archive`), so calling the wrong one always fails with
 * `plan.invalid_state`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockArchivePlanGenerateRestore, mockCalibrationRestore } = vi.hoisted(
  () => ({
    mockArchivePlanGenerateRestore: vi.fn(),
    mockCalibrationRestore: vi.fn(),
  }),
);

vi.mock('@/bindings/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      archivePlanGenerateRestore: mockArchivePlanGenerateRestore,
      calibrationMastersArchivePlanGenerateRestore: mockCalibrationRestore,
    },
  };
});

import { useGenerateRestorePlan } from './store';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const okResult = {
  status: 'ok' as const,
  data: { planId: 'p1', itemCount: 1, protectedItemCount: 0 },
};

describe('useGenerateRestorePlan — #886 entity routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes a project entity to archivePlanGenerateRestore', async () => {
    mockArchivePlanGenerateRestore.mockResolvedValue(okResult);
    const { result } = renderHook(() => useGenerateRestorePlan(), { wrapper });

    await result.current.mutateAsync({
      archivedViaPlanId: 'plan-1',
      entityType: 'project',
    });

    expect(mockArchivePlanGenerateRestore).toHaveBeenCalledWith('plan-1', null);
    expect(mockCalibrationRestore).not.toHaveBeenCalled();
  });

  it('routes a master entity to calibrationMastersArchivePlanGenerateRestore', async () => {
    mockCalibrationRestore.mockResolvedValue(okResult);
    const { result } = renderHook(() => useGenerateRestorePlan(), { wrapper });

    await result.current.mutateAsync({
      archivedViaPlanId: 'plan-2',
      entityType: 'master',
    });

    expect(mockCalibrationRestore).toHaveBeenCalledWith('plan-2', null);
    expect(mockArchivePlanGenerateRestore).not.toHaveBeenCalled();
  });
});
