/**
 * useGuidedFlow — React hook that manages guided flow state (spec 010).
 *
 * On first mount after first-run setup, activates the flow.
 * Exposes state + dismiss/restart actions consumed by GuidedOverlay and Settings.
 *
 * T105: server state reads/mutations are now keyed via queryKeys.guided.state()
 * so TanStack Query owns the cache layer. activate/dismiss/restart are useMutation;
 * the state returned is derived from query cache via setQueryData on success.
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import {
  activateGuidedFlow,
  dismissGuidedFlow,
  restartGuidedFlow,
  getGuidedState,
  type GuidedFlowStateDto,
} from './store';

export interface GuidedFlowHook {
  state: GuidedFlowStateDto | null;
  loading: boolean;
  dismiss: () => Promise<void>;
  restart: () => Promise<void>;
}

/**
 * Initialize and manage guided-flow state.
 *
 * @param setupCompleted - Pass `true` when first-run setup has completed
 *   so the hook knows to activate the flow.  Pass `false`/`undefined` to
 *   skip (e.g. when still in first-run setup).
 */
export function useGuidedFlow(
  setupCompleted: boolean | undefined,
): GuidedFlowHook {
  const queryClient = useQueryClient();
  const guidedKey = queryKeys.guided.state();

  // Server read — keyed so TanStack Query owns the cache.
  // Only enabled when setupCompleted is true so it doesn't fire prematurely.
  const { data: queryState, isFetching } = useQuery<GuidedFlowStateDto>({
    queryKey: guidedKey,
    queryFn: getGuidedState,
    enabled: !!setupCompleted,
    // Guided state rarely changes except through explicit mutations — stale
    // immediately so any re-mount after a mutation picks up the updated data.
    staleTime: 0,
  });

  // Activate mutation — called once when setupCompleted transitions to true.
  const activateMutation = useMutation<GuidedFlowStateDto, Error>({
    mutationFn: activateGuidedFlow,
    onSuccess: (dto) => {
      queryClient.setQueryData(guidedKey, dto);
    },
    onError: () => {
      // Backend unavailable — degrade gracefully (FR-007).
    },
  });

  // Activate the flow once setup is complete.
  useEffect(() => {
    if (!setupCompleted) return;
    activateMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupCompleted]);

  // Dismiss mutation.
  const dismissMutation = useMutation<{ dismissedAt: string }, Error>({
    mutationFn: dismissGuidedFlow,
    onSuccess: () => {
      queryClient.setQueryData<GuidedFlowStateDto | null>(guidedKey, (prev) =>
        prev
          ? {
              ...prev,
              dismissed: true,
              dismissedAt: new Date().toISOString(),
              currentStep: null,
            }
          : (prev ?? null),
      );
    },
  });

  const dismiss = async () => {
    try {
      await dismissMutation.mutateAsync();
    } catch {
      // Best-effort; silent failure keeps UI responsive.
    }
  };

  // Restart mutation.
  const restartMutation = useMutation<GuidedFlowStateDto, Error>({
    mutationFn: restartGuidedFlow,
    onSuccess: (dto) => {
      queryClient.setQueryData(guidedKey, dto);
    },
  });

  const restart = async () => {
    try {
      await restartMutation.mutateAsync();
    } catch {
      // Best-effort.
    }
  };

  const loading = isFetching || activateMutation.isPending;

  return { state: queryState ?? null, loading, dismiss, restart };
}
