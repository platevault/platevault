import type { PillVariant } from '@/ui';
import type { ProjectState, SessionState } from '@/bindings/index';
import { m } from '@/lib/i18n';

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

// The state→display maps below are keyed by the generated `ProjectState` /
// `SessionState` unions (not `string`), so they are *exhaustive*: adding or
// removing a variant in the Rust contract makes these objects a compile error
// until the new state is given an index / label / variant (spec 042 US7 T192).

/** Maps a stored project state to its index in the linear lifecycle (-1 = off-track, e.g. blocked). */
export const projectStateIndex: Record<ProjectState, number> = {
  setup_incomplete: 0,
  ready: 1,
  prepared: 2,
  processing: 3,
  completed: 4,
  archived: 5,
  blocked: -1,
};

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8) —
// the Record itself stays exhaustive over `ProjectState`, but no `m.*()` call
// happens until `projectStateLabel` actually invokes the thunk.
const PROJECT_STATE_LABEL_FNS: Record<ProjectState, () => string> = {
  setup_incomplete: () => m.lifecycle_state_setup(),
  ready: () => m.lifecycle_state_ready(),
  prepared: () => m.lifecycle_state_prepared(),
  processing: () => m.lifecycle_state_processing(),
  completed: () => m.lifecycle_state_completed(),
  archived: () => m.lifecycle_state_archived(),
  blocked: () => m.lifecycle_state_blocked(),
};

const PROJECT_STATE_VARIANTS: Record<ProjectState, PillVariant> = {
  completed: 'ok',
  archived: 'ok',
  processing: 'info',
  prepared: 'accent',
  ready: 'neutral',
  blocked: 'danger',
  setup_incomplete: 'ghost',
};

export function projectStateLabel(state: string): string {
  return PROJECT_STATE_LABEL_FNS[state as ProjectState]?.() ?? state;
}

export function projectStateVariant(state: string): PillVariant {
  return PROJECT_STATE_VARIANTS[state as ProjectState] ?? 'neutral';
}

// ─── Acquisition session states ──────────────────────────────────────────────

const SESSION_STATE_VARIANTS: Record<SessionState, PillVariant> = {
  confirmed: 'ok',
  // discovered / candidate / needs_review all surface as "Needs review" in the
  // UI — give them one variant so identical labels never render in two colors.
  needs_review: 'warn',
  discovered: 'warn',
  candidate: 'warn',
  rejected: 'danger',
  ignored: 'neutral',
};

export function sessionStateLabel(state: string): string {
  const s = state.replace(/_/g, ' ');
  // Title-case the first letter so labels read consistently (e.g. "Needs review",
  // "Confirmed") regardless of which render path produced them.
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sessionStateVariant(state: string): PillVariant {
  return SESSION_STATE_VARIANTS[state as SessionState] ?? 'neutral';
}
