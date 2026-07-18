// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spec 008 project store — TanStack Query hooks.
 *
 * All server state is managed via useQuery / useMutation. The QueryClient
 * (mounted at the app root) handles caching, deduplication, and bounded
 * eviction — replacing the old module-level singleton + unbounded Map.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { queryClient as sharedQueryClient } from '@/data/queryClient';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import { useMemo } from 'react';
import { useInventorySources } from '@/features/sessions/store';
import { applyProjectLifecycleTransition } from './lifecycleTransition';
import type {
  ProjectLifecycleState,
  LifecycleTransitionResponse,
} from './lifecycleTransition';
import type { ProjectSummaryDto, ProjectDetailDto } from '@/bindings/index';
import type {
  ProjectCreateRequest,
  ProjectCreateResult,
  ProjectUpdateRequest,
  ProjectUpdateResult,
  ProjectSourceAddRequest,
  ProjectSourceAddResult,
  ProjectSourceRemoveRequest,
  ProjectSourceRemoveResult,
  ProjectChannelsReinferRequest,
  ProjectChannelsReinferResult,
  ProjectChannelsDismissDriftRequest,
  ProjectChannelsDismissDriftResult,
} from '@/bindings/index';

// Local IPC helpers — migrated off the hand-written @/api/commands wrappers
// (spec 037) onto the generated bindings. unwrap() turns the generated Result
// into the throw-on-error contract the hooks/helpers below rely on.

async function listProjects008(): Promise<ProjectSummaryDto[]> {
  return unwrap(await commands.projectsList(null));
}

async function getProject008(args: { id: string }): Promise<ProjectDetailDto> {
  return unwrap(await commands.projectsGet(args.id));
}

async function createProject(
  req: ProjectCreateRequest,
): Promise<ProjectCreateResult> {
  return unwrap(
    await commands.projectsCreate(ipcArgs<typeof commands.projectsCreate>(req)),
  );
}

async function updateProject(
  req: ProjectUpdateRequest,
): Promise<ProjectUpdateResult> {
  return unwrap(
    await commands.projectsUpdate(ipcArgs<typeof commands.projectsUpdate>(req)),
  );
}

async function addProjectSource(
  req: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  return unwrap(await commands.projectsSourceAdd(req));
}

async function removeProjectSource(
  req: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  return unwrap(await commands.projectsSourceRemove(req));
}

async function reinferProjectChannels(
  req: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  return unwrap(await commands.projectsChannelsReinfer(req));
}

async function dismissProjectChannelDrift(
  req: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  return unwrap(await commands.projectsChannelsDismissDrift(req));
}

// Query state shape (matches old QueryState<T> surface for backward compat)

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

// Query hooks

/** Subscribe to the project list. */
export function useProjects(): QueryState<ProjectSummaryDto[]> {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: () => listProjects008(),
  });
  return {
    data,
    loading: isFetching,
    error: error ?? undefined,
  };
}

/** Subscribe to a single project detail. */
export function useProjectDetail(id: string): QueryState<ProjectDetailDto> {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => getProject008({ id }),
    enabled: !!id,
  });
  return {
    data,
    loading: isFetching,
    error: error ?? undefined,
  };
}

/**
 * Resolve project-source (Inventory session) ids to their human-readable
 * names, the same names the Sessions page already computes server-side
 * (#663 — project detail otherwise falls back to raw UUIDs because
 * `ProjectSourceDto.name` is unpopulated). Sourced from the shared Inventory
 * query, so it reuses the Sessions page's cache when both are warm.
 */
export function useSessionNames(): Map<string, string> {
  const { data } = useInventorySources();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const source of data?.sources ?? []) {
      for (const session of source.sessions) {
        map.set(session.id, session.name);
      }
    }
    return map;
  }, [data]);
}

// Mutation hooks

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation<ProjectCreateResult, Error, ProjectCreateRequest>({
    mutationFn: createProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(),
      });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation<ProjectUpdateResult, Error, ProjectUpdateRequest>({
    mutationFn: updateProject,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

export function useAddProjectSource() {
  const queryClient = useQueryClient();
  return useMutation<ProjectSourceAddResult, Error, ProjectSourceAddRequest>({
    mutationFn: addProjectSource,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

export function useRemoveProjectSource() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectSourceRemoveResult,
    Error,
    ProjectSourceRemoveRequest
  >({
    mutationFn: removeProjectSource,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

export function useReinferChannels() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectChannelsReinferResult,
    Error,
    ProjectChannelsReinferRequest
  >({
    mutationFn: reinferProjectChannels,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

export function useDismissChannelDrift() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectChannelsDismissDriftResult,
    Error,
    ProjectChannelsDismissDriftRequest
  >({
    mutationFn: dismissProjectChannelDrift,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

// Legacy async call helpers kept for existing event-handler callers.

// Each helper invalidates the same query keys as its `use*Mutation` hook
// counterpart, via the shared QueryClient singleton — so event-handler callers
// that use these helpers (rather than the hooks) still refresh the list/detail
// after a mutation (regression F1).

export async function callCreateProject(
  req: ProjectCreateRequest,
): Promise<ProjectCreateResult> {
  const result = await createProject(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.all(),
  });
  return result;
}

export async function callUpdateProject(
  req: ProjectUpdateRequest,
): Promise<ProjectUpdateResult> {
  const result = await updateProject(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.all(),
  });
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(req.projectId),
  });
  return result;
}

export async function callAddProjectSource(
  req: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  const result = await addProjectSource(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(req.projectId),
  });
  return result;
}

export async function callRemoveProjectSource(
  req: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  const result = await removeProjectSource(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(req.projectId),
  });
  return result;
}

export async function callReinferChannels(
  req: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  const result = await reinferProjectChannels(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(req.projectId),
  });
  return result;
}

export async function callDismissChannelDrift(
  req: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  const result = await dismissProjectChannelDrift(req);
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(req.projectId),
  });
  return result;
}

/**
 * Apply a lifecycle transition (standalone async form).
 * Prefer useTransitionLifecycle() for components needing reactive invalidation.
 */
export async function callTransitionLifecycle(
  projectId: string,
  currentState: ProjectLifecycleState,
  nextState: ProjectLifecycleState,
  actionLabel?: string,
): Promise<LifecycleTransitionResponse> {
  const result = await applyProjectLifecycleTransition({
    contractVersion: '2.0.0',
    requestId: crypto.randomUUID(),
    entityType: 'project',
    entityId: projectId,
    currentState,
    nextState,
    actionLabel,
    actor: 'user',
  });
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.all(),
  });
  void sharedQueryClient.invalidateQueries({
    queryKey: queryKeys.projects.detail(projectId),
  });
  return result;
}

export function useTransitionLifecycle() {
  const queryClient = useQueryClient();
  return useMutation<
    LifecycleTransitionResponse,
    Error,
    {
      projectId: string;
      currentState: ProjectLifecycleState;
      nextState: ProjectLifecycleState;
      actionLabel?: string;
    }
  >({
    mutationFn: ({ projectId, currentState, nextState, actionLabel }) =>
      callTransitionLifecycle(projectId, currentState, nextState, actionLabel),
    onSuccess: (result, variables) => {
      if (result.status === 'success') {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(variables.projectId),
        });
      }
    },
  });
}

// Re-export types needed by consumers
export type { ProjectLifecycleState, LifecycleTransitionResponse };
