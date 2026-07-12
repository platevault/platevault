import { PROJECT_LIFECYCLE, projectStateIndex } from '@/lib/lifecycle';
import { m } from '@/lib/i18n';

export interface LifecycleProps {
  /** Stored project state (e.g. "processing", "setup_incomplete", "blocked"). */
  state: string;
}

/**
 * Vertical lifecycle flowchart for a project's state. Renders the centralized
 * PROJECT_LIFECYCLE steps with done/active styling, plus a trailing blocked
 * marker when the project is off-track. Lives in the detail rail (design v4).
 */
export function Lifecycle({ state }: LifecycleProps) {
  // `state` is an arbitrary string; `projectStateIndex` is now keyed by the
  // exhaustive `ProjectState` union, so coerce at the lookup and fall back to
  // -1 (off-track) for any unknown value.
  const currentIdx =
    projectStateIndex[state as keyof typeof projectStateIndex] ?? -1;
  const isBlocked = state === 'blocked';

  return (
    <div className="alm-lifecycle">
      {PROJECT_LIFECYCLE.map((step, i) => {
        const isDone = !isBlocked && i < currentIdx;
        const isCurrent = !isBlocked && i === currentIdx;

        const dotClass = [
          'alm-lifecycle__dot',
          isDone && 'alm-lifecycle__dot--done',
          isCurrent && 'alm-lifecycle__dot--active',
        ]
          .filter(Boolean)
          .join(' ');

        const labelClass = [
          'alm-lifecycle__label',
          isDone && 'alm-lifecycle__label--done',
          isCurrent && 'alm-lifecycle__label--active',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={step} className="alm-lifecycle__step">
            <div className="alm-lifecycle__connector">
              {i > 0 && (
                <div
                  className={`alm-lifecycle__line${isDone || isCurrent ? ' alm-lifecycle__line--done' : ''}`}
                />
              )}
              <div className={dotClass} />
              {i < PROJECT_LIFECYCLE.length - 1 && (
                <div
                  className={`alm-lifecycle__line${isDone ? ' alm-lifecycle__line--done' : ''}`}
                />
              )}
            </div>
            <span className={labelClass}>{step}</span>
          </div>
        );
      })}
      {isBlocked && (
        <div className="alm-lifecycle__step">
          <div className="alm-lifecycle__connector">
            <div className="alm-lifecycle__line" />
            <div className="alm-lifecycle__dot alm-lifecycle__dot--blocked" />
          </div>
          <span className="alm-lifecycle__label alm-lifecycle__label--danger">
            {m.projects_stepper_blocked_chip()}
          </span>
        </div>
      )}
    </div>
  );
}
