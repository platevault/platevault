// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Archive store — spec 017 WP-B P3 frontend wiring.
 *
 * TanStack Query hooks over the real `archive.*` / `audit.*` IPC commands,
 * replacing the ARCHIVE_DATA fixture. Follows the same pattern as
 * `features/projects/store.ts`: `unwrap()` turns the generated Result into a
 * throw-on-error contract for `useQuery`/`useMutation`.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  ArchiveEntry,
  AuditEntry,
  ArchiveSendToTrashResponse,
  ArchivePermanentlyDeleteResponse,
  GenerateArchivePlanResult,
  GenerateRestorePlanResult,
} from '@/bindings/index';

// Local IPC helpers — mirror the `unwrap()` pattern used by projects/store.ts.

async function listArchive(): Promise<ArchiveEntry[]> {
  const res = unwrap(await commands.archiveList());
  return res.entries;
}

async function listArchiveAudit(entityId: string): Promise<AuditEntry[]> {
  const res = unwrap(
    await commands.auditList({ entityType: 'project', entityId }, null),
  );
  return res.entries;
}

async function sendToTrash(
  planId: string,
): Promise<ArchiveSendToTrashResponse> {
  return unwrap(await commands.archiveSendToTrash(planId));
}

async function permanentlyDelete(
  planId: string,
): Promise<ArchivePermanentlyDeleteResponse> {
  return unwrap(await commands.archivePermanentlyDelete(planId, 'DELETE'));
}

async function generateArchivePlan(
  projectId: string,
): Promise<GenerateArchivePlanResult> {
  return unwrap(await commands.archivePlanGenerate(projectId, null));
}

/**
 * Materialise a reviewable restore (un-archive) plan (#885 project, #886
 * master). `entityType` picks the backend command: a master-archive plan
 * (`origin = calibration_master_archive`) is only valid input to the
 * calibration-scoped restore generator, not the project one (and vice
 * versa) — `archive_generator::generate_restore_generic`'s origin check
 * would otherwise reject a cross-called request with `plan.invalid_state`.
 */
async function generateRestorePlan(args: {
  archivedViaPlanId: string;
  entityType: string;
}): Promise<GenerateRestorePlanResult> {
  return unwrap(
    args.entityType === 'master'
      ? await commands.calibrationMastersArchivePlanGenerateRestore(
          args.archivedViaPlanId,
          null,
        )
      : await commands.archivePlanGenerateRestore(args.archivedViaPlanId, null),
  );
}

// Query state shape (matches the projects/store.ts QueryState<T> surface).

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

/** Subscribe to the archived-entries list (projects, C5; masters, #886). */
export function useArchiveList(): QueryState<ArchiveEntry[]> {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.archive.list(),
    queryFn: listArchive,
  });
  return {
    data,
    loading: isFetching,
    error: error ?? undefined,
  };
}

/** Subscribe to the audit history for one archived project. */
export function useArchiveAudit(
  entityId: string | undefined,
): QueryState<AuditEntry[]> {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.archive.audit(entityId ?? ''),
    queryFn: () => listArchiveAudit(entityId as string),
    enabled: Boolean(entityId),
  });
  return {
    data,
    loading: isFetching,
    error: error ?? undefined,
  };
}

/** Send an archived project's plan subtree to the OS trash. */
export function useSendToTrash() {
  const queryClient = useQueryClient();
  return useMutation<ArchiveSendToTrashResponse, Error, string>({
    mutationFn: sendToTrash,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.archive.list(),
      });
    },
  });
}

/** Permanently delete an archived project's plan subtree. */
export function usePermanentlyDelete() {
  const queryClient = useQueryClient();
  return useMutation<ArchivePermanentlyDeleteResponse, Error, string>({
    mutationFn: permanentlyDelete,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.archive.list(),
      });
    },
  });
}

/**
 * Materialise a reviewable whole-project archive plan (spec 017 US2/WP-B).
 * The ONLY UI entry point that calls `archive.plan.generate` — previously
 * the completed→archived lifecycle transition dead-ended on a "create or
 * approve a plan first" toast with no route to actually create one.
 */
export function useGenerateArchivePlan() {
  return useMutation<GenerateArchivePlanResult, Error, string>({
    mutationFn: generateArchivePlan,
  });
}

/**
 * Materialise a reviewable restore (un-archive) plan for an archived entry
 * (#885). The ONLY UI entry point that calls `archive.plan.generate_restore`
 * — mirrors {@link useGenerateArchivePlan}'s shape so the Archive page can
 * open the same {@link PlanReviewOverlay} on the result.
 */
export function useGenerateRestorePlan() {
  return useMutation<
    GenerateRestorePlanResult,
    Error,
    { archivedViaPlanId: string; entityType: string }
  >({
    mutationFn: generateRestorePlan,
  });
}
