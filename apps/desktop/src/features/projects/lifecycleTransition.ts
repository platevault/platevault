// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Project lifecycle transition IPC helper (spec 037 caller migration).
 *
 * Moves the `applyProjectLifecycleTransition` glue off the hand-written
 * `@/api/commands` wrapper onto the generated `commands.lifecycleTransitionApply`
 * binding (FR-004: the behaviour is moved, not dropped). The wire shape is the
 * canonical FLAT discriminated envelope from the source-of-truth contract
 * (`packages/contracts/src/generated/lifecycle.transition.d.ts`): `entityType`
 * is the serde tag on the backend's `TransitionRequest` and the remaining
 * fields sit beside it — there is NO `{ project: {...} }` wrapper (issue #423:
 * the previous wrapped payload was rejected by the backend with
 * `missing field entityType`). This helper builds the `project` family request
 * and unwraps the generated `Result` into the throw-on-error contract callers
 * expect.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
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
  // The cast is required because tauri-specta renders the internally-tagged
  // `TransitionRequest` enum as an externally-wrapped union
  // (`{ project: {...} }`) that does NOT match the serde wire format. The flat
  // `req` (with its `entityType: 'project'` discriminator) IS the wire truth —
  // pinned by the backend round-trip tests
  // (`crates/contracts/core/tests/lifecycle_transition_roundtrip.rs`) and the
  // spec-037 `lifecycle_integrity` E2E journey.
  return unwrap(
    await commands.lifecycleTransitionApply(
      ipcArgs<typeof commands.lifecycleTransitionApply>(req),
    ),
  ) as LifecycleTransitionResponse;
}
