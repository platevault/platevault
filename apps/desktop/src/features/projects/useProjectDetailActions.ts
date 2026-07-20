// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Action handlers + in-flight state for the Project detail pane (#998,
 * extracted from ProjectDetail.tsx).
 *
 * Owns every mutating interaction the pane offers — channel re-infer / drift
 * dismiss, lifecycle transitions, archive-plan generation and review, and OS
 * reveal — plus the busy flags that gate their buttons.
 *
 * Called UNCONDITIONALLY from the component, before its loading/error early
 * returns, so `project` is `undefined` on the first renders; every handler
 * that needs it guards accordingly.
 */

import { useState } from 'react';
import type { ProjectDetailDto } from '@/bindings/index';
import { queryKeys } from '@/data/queryKeys';
import { queryClient as sharedQueryClient } from '@/data/queryClient';
import { m } from '@/lib/i18n';
import { revealInOs } from '@/shared/native/reveal';
import { addToast } from '@/shared/toast';
import { useGenerateArchivePlan } from '@/features/archive/store';
import type { RecoveryEdge } from './BlockedBanner';
import { isPlanRequiredError } from './lifecycle-actions';
import {
  callDismissChannelDrift,
  callReinferChannels,
  callTransitionLifecycle,
} from './store';
import type { ProjectLifecycleState } from './store';

export function useProjectDetailActions(
  projectId: string,
  project: ProjectDetailDto | undefined,
) {
  const [channelWorking, setChannelWorking] = useState(false);
  const [transitionWorking, setTransitionWorking] = useState(false);
  // Archive plan generation (spec 017 US2/WP-B) — the completed→archived
  // transition is plan-gated; this is the UI entry point that actually
  // creates the reviewable plan the toast below points the user to.
  const generateArchivePlan = useGenerateArchivePlan();
  const [archiveReviewPlanId, setArchiveReviewPlanId] = useState<string | null>(
    null,
  );
  // #603: diagnostic sentence for a 0-item archive plan, surfaced by
  // `archive.plan.generate` alongside the plan id — the review overlay has
  // no other way to explain WHY a plan came back empty.
  const [archiveEmptyReason, setArchiveEmptyReason] = useState<string | null>(
    null,
  );

  const lifecycle =
    typeof project?.lifecycle === 'string'
      ? project.lifecycle
      : 'setup_incomplete';

  const handleReinfer = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callReinferChannels({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({
        message: m.projects_toast_reinfer_failed(),
        variant: 'error',
      });
    } finally {
      setChannelWorking(false);
    }
  };

  const handleDismissDrift = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callDismissChannelDrift({
        requestId: crypto.randomUUID(),
        projectId,
      });
    } catch {
      addToast({
        message: m.projects_toast_dismiss_failed(),
        variant: 'error',
      });
    } finally {
      setChannelWorking(false);
    }
  };

  /**
   * Handle a lifecycle transition. Surfaces plan.required as an info toast
   * directing the user to the plan flow (US3-4 / US3-5). For the
   * completed/blocked → archived edge specifically, a generator command
   * (`archive.plan.generate`) exists, so a refusal here also generates the
   * plan and opens the shared review/apply overlay — previously this edge
   * dead-ended on the toast with no way to actually create the plan.
   */
  const handleTransition = async (
    nextState: ProjectLifecycleState,
    actionLabel?: string,
  ) => {
    if (transitionWorking) return;
    setTransitionWorking(true);
    try {
      const resp = await callTransitionLifecycle(
        projectId,
        lifecycle as ProjectLifecycleState,
        nextState,
        actionLabel,
      );
      if (resp.status === 'success') {
        addToast({
          message: m.projects_toast_transitioned({
            state: resp.newState ?? nextState,
          }),
          variant: 'success',
        });
      } else if (
        resp.status === 'error' &&
        isPlanRequiredError(resp.error?.code)
      ) {
        addToast({
          message: m.projects_toast_plan_required(),
          variant: 'info',
        });
        if (nextState === 'archived') {
          void handleGenerateArchivePlan();
        }
      } else if (resp.status === 'error') {
        addToast({
          message: resp.error?.message ?? m.projects_toast_transition_refused(),
          variant: 'error',
        });
      }
    } catch {
      addToast({
        message: m.projects_toast_transition_failed(),
        variant: 'error',
      });
    } finally {
      setTransitionWorking(false);
    }
  };

  /**
   * Generate a reviewable whole-project archive plan (`archive.plan.generate`)
   * and open the shared PlanReviewOverlay for review + apply. This is the ONLY
   * UI entry point for the command — previously it had zero callers and the
   * flow only worked driven over the dev bridge.
   */
  const handleGenerateArchivePlan = async () => {
    try {
      const res = await generateArchivePlan.mutateAsync(projectId);
      addToast({
        message: m.projects_archive_plan_created_toast({
          count: res.itemCount,
        }),
        variant: 'info',
      });
      setArchiveEmptyReason(res.emptyReason ?? null);
      setArchiveReviewPlanId(res.planId);
    } catch {
      addToast({
        message: m.archive_generate_failed(),
        variant: 'error',
      });
    }
  };

  /** After the archive plan applies, the project's lifecycle flips server-side
   * (C5 — applying an origin=archive plan is the one legitimate path to
   * `archived`); refresh the detail query so the UI reflects it. */
  const handleArchivePlanApplied = () => {
    void sharedQueryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(projectId),
    });
  };

  /** Handle blocked resolve — dispatches the recovery edge from BlockedBanner. */
  const handleResolveBlocked = (edge: RecoveryEdge) => {
    void handleTransition(edge, 'Resolved blocker');
  };

  /** Reveal the project folder in the OS file manager (spec 012 / native reveal). */
  const handleReveal = async () => {
    if (!project?.path) return;
    try {
      await revealInOs(project.path, {
        entityKind: 'project_manifest',
        entityId: projectId,
      });
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : m.common_reveal_error();
      addToast({ message: msg, variant: 'error' });
    }
  };

  return {
    lifecycle,
    channelWorking,
    transitionWorking,
    archiveReviewPlanId,
    setArchiveReviewPlanId,
    archiveEmptyReason,
    setArchiveEmptyReason,
    handleReinfer,
    handleDismissDrift,
    handleTransition,
    handleArchivePlanApplied,
    handleResolveBlocked,
    handleReveal,
  };
}
