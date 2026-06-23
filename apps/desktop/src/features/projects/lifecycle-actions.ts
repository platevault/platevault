/**
 * Lifecycle footer action helpers — spec 009 US3.
 *
 * Defines the contextual footer actions per lifecycle state and derives the
 * target state for each action. The components dispatch `useTransitionLifecycle`
 * with the returned `nextState`.
 *
 * Plan-gated edges (ready → prepared, completed → archived, blocked → archived,
 * archived → ready, archived → processing) are marked `requiresPlan: true` so
 * the UI can intercept the response and surface the plan-create flow (US3-4 / US3-5).
 *
 * Forbidden edges (e.g. processing → ready) are not included.
 */

import { m } from '@/lib/i18n';
import type { ProjectLifecycleState } from './store';

export interface LifecycleAction {
  label: string;
  /** Target state for the transition. */
  nextState: ProjectLifecycleState;
  /** True when the backend will return plan.required for this edge. */
  requiresPlan: boolean;
  /** Button variant for the primary action. */
  variant: 'primary' | 'accent' | 'danger' | 'ghost';
  /** If true, this is the primary (most prominent) footer action. */
  primary: boolean;
}

/**
 * Derive the ordered footer actions for a given lifecycle state.
 *
 * Returns an empty array when the state is `archived` (handled via Unarchive
 * buttons) or when no meaningful user action exists.
 */
export function lifecycleFooterActions(
  currentState: ProjectLifecycleState,
): LifecycleAction[] {
  switch (currentState) {
    case 'setup_incomplete':
      return [];

    case 'ready':
      return [
        {
          label: m.projects_lifecycle_prepare(),
          nextState: 'prepared',
          requiresPlan: true,
          variant: 'primary',
          primary: true,
        },
        {
          label: m.projects_lifecycle_mark_processing(),
          nextState: 'processing',
          requiresPlan: false,
          variant: 'ghost',
          primary: false,
        },
      ];

    case 'prepared':
      return [
        {
          label: m.projects_lifecycle_mark_processing(),
          nextState: 'processing',
          requiresPlan: false,
          variant: 'primary',
          primary: true,
        },
        {
          label: m.projects_lifecycle_revert_ready(),
          nextState: 'ready',
          requiresPlan: true,
          variant: 'ghost',
          primary: false,
        },
      ];

    case 'processing':
      return [
        {
          label: m.projects_lifecycle_mark_completed(),
          nextState: 'completed',
          requiresPlan: false,
          variant: 'primary',
          primary: true,
        },
      ];

    case 'completed':
      return [
        {
          label: m.projects_lifecycle_archive(),
          nextState: 'archived',
          requiresPlan: true,
          variant: 'primary',
          primary: true,
        },
        {
          label: m.projects_lifecycle_reopen(),
          nextState: 'processing',
          requiresPlan: false,
          variant: 'ghost',
          primary: false,
        },
      ];

    case 'archived':
      return [
        {
          label: m.projects_lifecycle_unarchive(),
          nextState: 'ready',
          requiresPlan: true,
          variant: 'primary',
          primary: true,
        },
        {
          label: m.projects_lifecycle_unarchive_resume(),
          nextState: 'processing',
          requiresPlan: true,
          variant: 'ghost',
          primary: false,
        },
      ];

    case 'blocked':
      // Blocked state: resolve routing handled by BlockedBanner (US4-3).
      // The overflow menu may also show "Archive from blocked" (blocked → archived).
      return [
        {
          label: m.projects_lifecycle_archive_blocked(),
          nextState: 'archived',
          requiresPlan: true,
          variant: 'ghost',
          primary: false,
        },
      ];

    default:
      return [];
  }
}

/**
 * Determines whether a transition response error should surface a plan-create
 * interstitial (true) or a generic error toast (false).
 */
export function isPlanRequiredError(errorCode?: string): boolean {
  return errorCode === 'plan.required' || errorCode === 'plan.not_approved';
}
