/**
 * Spec 008 project store — TanStack Query hooks.
 *
 * All server state is managed via useQuery / useMutation. The QueryClient
 * (mounted at the app root) handles caching, deduplication, and bounded
 * eviction — replacing the old module-level singleton + unbounded Map.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/data/queryKeys";
import {
  listProjects008,
  getProject008,
  createProject,
  updateProject,
  addProjectSource,
  removeProjectSource,
  reinferProjectChannels,
  dismissProjectChannelDrift,
  applyProjectLifecycleTransition,
} from "@/api/commands";
import type {
  ProjectLifecycleState,
  LifecycleTransitionResponse,
} from "@/api/commands";
import type { ProjectSummaryDto, ProjectDetailDto } from "@/bindings/index";
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
} from "@/bindings/index";

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

// Mutation hooks

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation<ProjectCreateResult, Error, ProjectCreateRequest>({
    mutationFn: createProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation<ProjectUpdateResult, Error, ProjectUpdateRequest>({
    mutationFn: updateProject,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
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
  return useMutation<ProjectSourceRemoveResult, Error, ProjectSourceRemoveRequest>({
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
  return useMutation<ProjectChannelsReinferResult, Error, ProjectChannelsReinferRequest>({
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
  return useMutation<ProjectChannelsDismissDriftResult, Error, ProjectChannelsDismissDriftRequest>({
    mutationFn: dismissProjectChannelDrift,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });
    },
  });
}

// Legacy async call helpers kept for existing event-handler callers.

export async function callCreateProject(req: ProjectCreateRequest): Promise<ProjectCreateResult> {
  return createProject(req);
}

export async function callUpdateProject(req: ProjectUpdateRequest): Promise<ProjectUpdateResult> {
  return updateProject(req);
}

export async function callAddProjectSource(
  req: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  return addProjectSource(req);
}

export async function callRemoveProjectSource(
  req: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  return removeProjectSource(req);
}

export async function callReinferChannels(
  req: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  return reinferProjectChannels(req);
}

export async function callDismissChannelDrift(
  req: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  return dismissProjectChannelDrift(req);
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
  return applyProjectLifecycleTransition({
    contractVersion: "2.0.0",
    requestId: crypto.randomUUID(),
    entityType: "project",
    entityId: projectId,
    currentState,
    nextState,
    actionLabel,
    actor: "user",
  });
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
      if (result.status === "success") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(variables.projectId),
        });
      }
    },
  });
}

// Re-export types needed by consumers
export type { ProjectLifecycleState, LifecycleTransitionResponse };
