/**
 * Cleanup-plan store (spec 017 WP-E) — TanStack mutation hooks over the
 * two-step cleanup flow (D11):
 *
 *   1. `cleanup.scan`          — pure, read-only preview (no plan row).
 *   2. `cleanup.plan.generate` — materialise the reviewable plan.
 *
 * Follows the `features/archive/store.ts` pattern: `unwrap()` turns the
 * generated Result into a throw-on-error contract for `useMutation`.
 */

import { useMutation } from '@tanstack/react-query';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  CleanupScanResult,
  GenerateCleanupPlanResult,
} from '@/bindings/index';

/** Canonical destructive-destination vocabulary (spec 033 vocab split). */
export type DestructiveDestinationChoice = 'archive' | 'trash';

export interface GenerateCleanupPlanArgs {
  projectId: string;
  destructiveDestination: DestructiveDestinationChoice;
}

/** On-demand, read-only cleanup preview for one project (D11 step 1). */
export function useCleanupScan() {
  return useMutation<CleanupScanResult, Error, string>({
    mutationFn: async (projectId) =>
      unwrap(await commands.cleanupScan(projectId)),
  });
}

/** Materialise a reviewable cleanup plan from the current candidates (D11 step 2). */
export function useGenerateCleanupPlan() {
  return useMutation<GenerateCleanupPlanResult, Error, GenerateCleanupPlanArgs>(
    {
      mutationFn: async ({ projectId, destructiveDestination }) =>
        unwrap(
          await commands.cleanupPlanGenerate({
            projectId,
            title: null,
            destructiveDestination,
          }),
        ),
    },
  );
}
