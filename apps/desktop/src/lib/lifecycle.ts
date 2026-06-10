import type { PillVariant } from '@/ui';

/**
 * Centralized project lifecycle model — the single source of truth for the
 * ordered states, their display labels, and their pill variants. Imported by
 * the Lifecycle component and any detail/list surface that renders project
 * state, so the mapping is defined exactly once (design v4).
 */
export const PROJECT_LIFECYCLE = [
  'setup',
  'ready',
  'prepared',
  'processing',
  'completed',
  'archived',
] as const;

export type ProjectLifecycleStep = (typeof PROJECT_LIFECYCLE)[number];

/** Maps a stored project state to its index in the linear lifecycle (-1 = off-track, e.g. blocked). */
export const projectStateIndex: Record<string, number> = {
  setup_incomplete: 0,
  ready: 1,
  prepared: 2,
  processing: 3,
  completed: 4,
  archived: 5,
  blocked: -1,
};

const PROJECT_STATE_LABELS: Record<string, string> = {
  setup_incomplete: 'Setup',
  ready: 'Ready',
  prepared: 'Prepared',
  processing: 'Processing',
  completed: 'Completed',
  archived: 'Archived',
  blocked: 'Blocked',
};

const PROJECT_STATE_VARIANTS: Record<string, PillVariant> = {
  completed: 'ok',
  archived: 'ok',
  processing: 'info',
  prepared: 'accent',
  ready: 'neutral',
  blocked: 'danger',
  setup_incomplete: 'ghost',
};

export function projectStateLabel(state: string): string {
  return PROJECT_STATE_LABELS[state] ?? state;
}

export function projectStateVariant(state: string): PillVariant {
  return PROJECT_STATE_VARIANTS[state] ?? 'neutral';
}

// ─── Acquisition session states ──────────────────────────────────────────────

const SESSION_STATE_VARIANTS: Record<string, PillVariant> = {
  confirmed: 'ok',
  needs_review: 'warn',
  rejected: 'danger',
  discovered: 'ghost',
  candidate: 'neutral',
  ignored: 'neutral',
};

export function sessionStateLabel(state: string): string {
  return state.replace(/_/g, ' ');
}

export function sessionStateVariant(state: string): PillVariant {
  return SESSION_STATE_VARIANTS[state] ?? 'neutral';
}
