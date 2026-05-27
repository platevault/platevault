/**
 * Display utilities -- consolidates state-to-variant and state-to-label
 * mappings that were duplicated across SessionsList, SessionDetail,
 * TargetDetailPane, ProjectDetail, ProjectsList, and LifecycleSidebar.
 */

export type PillVariant = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'ghost';

/**
 * Map a session state string to a Pill variant for consistent color coding.
 */
export function sessionStateVariant(state: string): PillVariant {
  switch (state) {
    case 'confirmed':
    case 'complete':
      return 'ok';
    case 'pending':
    case 'review':
      return 'warn';
    case 'rejected':
    case 'error':
      return 'danger';
    case 'processing':
    case 'queued':
      return 'info';
    case 'draft':
      return 'ghost';
    default:
      return 'neutral';
  }
}

/**
 * Map a session state string to a human-readable label.
 */
export function sessionStateLabel(state: string): string {
  switch (state) {
    case 'confirmed':
      return 'Confirmed';
    case 'complete':
      return 'Complete';
    case 'pending':
      return 'Pending';
    case 'review':
      return 'Review';
    case 'rejected':
      return 'Rejected';
    case 'error':
      return 'Error';
    case 'processing':
      return 'Processing';
    case 'queued':
      return 'Queued';
    case 'draft':
      return 'Draft';
    default:
      return state;
  }
}

/**
 * Map a project state string to a Pill variant for consistent color coding.
 */
export function projectStateVariant(state: string): PillVariant {
  switch (state) {
    case 'complete':
    case 'verified':
    case 'archived':
      return 'ok';
    case 'planning':
    case 'acquiring':
      return 'info';
    case 'processing':
    case 'reviewing':
      return 'warn';
    case 'stalled':
    case 'abandoned':
      return 'danger';
    case 'draft':
      return 'ghost';
    default:
      return 'neutral';
  }
}

/**
 * Map a project state string to a human-readable label.
 */
export function projectStateLabel(state: string): string {
  switch (state) {
    case 'complete':
      return 'Complete';
    case 'verified':
      return 'Verified';
    case 'archived':
      return 'Archived';
    case 'planning':
      return 'Planning';
    case 'acquiring':
      return 'Acquiring';
    case 'processing':
      return 'Processing';
    case 'reviewing':
      return 'Reviewing';
    case 'stalled':
      return 'Stalled';
    case 'abandoned':
      return 'Abandoned';
    case 'draft':
      return 'Draft';
    default:
      return state;
  }
}
