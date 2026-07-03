/**
 * Project lifecycle transition IPC helper (spec 037 caller migration).
 *
 * Moves the `applyProjectLifecycleTransition` glue off the hand-written
 * `@/api/commands` wrapper onto the generated `commands.lifecycleTransitionApply`
 * binding (FR-004: the behaviour is moved, not dropped). The generated
 * `lifecycle.transition.apply` command is a tagged union over entity kind
 * (`{ project: {...} }` | `{ plan: {...} }` | ...); this helper builds the
 * `project` variant and unwraps the generated `Result` into the throw-on-error
 * contract callers expect.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { ProjectState, TransitionActor } from '@/bindings/index';

export type ProjectLifecycleState = ProjectState;
export type { TransitionActor };

export interface ProjectLifecycleTransitionRequest {
  contractVersion: string;
  requestId: string;
  entityType: 'project';
  entityId: string;
  currentState: ProjectLifecycleState;
  nextState: ProjectLifecycleState;
  actionLabel?: string;
  actor: TransitionActor;
}

export type TransitionErrorCode =
  | 'transition.refused'
  | 'entity.not_found'
  | 'actor.not_authorised'
  | 'plan.required'
  | 'plan.not_approved'
  | 'provenance.unreviewed';

export interface TransitionError {
  code: TransitionErrorCode;
  message: string;
  details?: unknown;
}

export type TransitionStatus = 'success' | 'noop' | 'error';

export interface LifecycleTransitionResponse {
  status: TransitionStatus;
  contractVersion: string;
  requestId: string;
  appliedAt?: string;
  priorState?: string;
  newState?: string;
  auditId?: string;
  planId?: string;
  error?: TransitionError;
}

/**
 * Apply a project lifecycle transition.
 * Returns the transition response (check response.status for success/error).
 * Plan-required edges return status='error' with error.code='plan.required'.
 */
export async function applyProjectLifecycleTransition(
  req: ProjectLifecycleTransitionRequest,
): Promise<LifecycleTransitionResponse> {
  return unwrap(
    await commands.lifecycleTransitionApply(
      { project: req } as Parameters<typeof commands.lifecycleTransitionApply>[0],
    ),
  ) as LifecycleTransitionResponse;
}
