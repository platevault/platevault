/**
 * Per-frame inventory + raw sub-frame cleanup mutation/query hooks (spec 048
 * US1/US2/US3/US4 frontend). Frame-list and raw-cleanup scans follow the
 * on-demand, read-only `useMutation` pattern already established by
 * `features/projects/cleanupStore.ts`'s `useCleanupScan` (a pure preview the
 * UI triggers explicitly, not a background query) rather than introducing a
 * second idiom.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import * as ipc from './inventoryIpc';
import type {
  InventoryFrameListResponse,
  InventoryFrameListScope,
  InventoryReconcileRunResponse,
  InventoryFrameRelinkResponse,
  RootInventoryConfig,
  ReconcileMode,
  DetectionConfigUpdate,
  RawFrameCleanupScanResponse,
  RawFrameCleanupScope,
  RawFrameType,
  GenerateCleanupPlanResult,
} from '@/bindings/index';

/** On-demand `inventory.frame.list` scan for a session or root (T014). */
export function useFrameListScan() {
  return useMutation<
    InventoryFrameListResponse,
    Error,
    InventoryFrameListScope
  >({
    mutationFn: (scope) =>
      ipc.inventoryFrameList({ scope, includeMissing: true }),
  });
}

/** On-demand `inventory.reconcile.run` pass for one root (T022). */
export function useReconcileRoot() {
  return useMutation<InventoryReconcileRunResponse, Error, { rootId: string }>({
    mutationFn: ({ rootId }) =>
      ipc.inventoryReconcileRun({ rootId, reason: 'on_demand' }),
  });
}

/** Relink a surfaced `missing` frame to a candidate path under its root (T025). */
export function useRelinkFrame() {
  return useMutation<
    InventoryFrameRelinkResponse,
    Error,
    { frameId: string; candidateRelativePath: string }
  >({
    mutationFn: (req) => ipc.inventoryFrameRelink(req),
  });
}

/** Read a root's reconcile/detection config, with documented defaults filled in. */
export function useRootConfig(rootId: string | null) {
  return useQuery<RootInventoryConfig>({
    queryKey: queryKeys.inventory.rootConfig(rootId ?? ''),
    queryFn: () => ipc.inventoryRootConfigGet({ rootId: rootId as string }),
    enabled: rootId != null,
  });
}

/** Partial-update a root's reconcile/detection config (T034). */
export function useSetRootConfig(rootId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    RootInventoryConfig,
    Error,
    {
      reconcileMode?: ReconcileMode | null;
      detection?: DetectionConfigUpdate | null;
    }
  >({
    mutationFn: (patch) =>
      ipc.inventoryRootConfigSet({
        rootId,
        reconcileMode: patch.reconcileMode ?? null,
        detection: patch.detection ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.rootConfig(rootId),
      });
    },
  });
}

/** On-demand raw sub-frame `cleanup.candidates.scan` (US3 T031). */
export function useRawFrameCleanupScan() {
  return useMutation<
    RawFrameCleanupScanResponse,
    Error,
    { scope: RawFrameCleanupScope; kinds?: RawFrameType[] }
  >({
    mutationFn: ({ scope, kinds }) =>
      ipc.cleanupRawFramesScan({ scope, kinds: kinds ?? null }),
  });
}

/** Materialise a reviewable raw sub-frame cleanup plan (US3 T031). */
export function useGenerateRawFrameCleanupPlan() {
  return useMutation<
    GenerateCleanupPlanResult,
    Error,
    { selectedFrameIds: string[]; destructiveDestination: 'archive' | 'trash' }
  >({
    mutationFn: ({ selectedFrameIds, destructiveDestination }) =>
      ipc.cleanupRawFramesGenerate({
        selectedFrameIds,
        title: null,
        destructiveDestination,
      }),
  });
}
