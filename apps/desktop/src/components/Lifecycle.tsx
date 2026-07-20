// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
    <div className="pv-lifecycle">
      {PROJECT_LIFECYCLE.map((step, i) => {
        const isDone = !isBlocked && i < currentIdx;
        const isCurrent = !isBlocked && i === currentIdx;

        const dotClass = [
          'pv-lifecycle__dot',
          isDone && 'pv-lifecycle__dot--done',
          isCurrent && 'pv-lifecycle__dot--active',
        ]
          .filter(Boolean)
          .join(' ');

        const labelClass = [
          'pv-lifecycle__label',
          isDone && 'pv-lifecycle__label--done',
          isCurrent && 'pv-lifecycle__label--active',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={step} className="pv-lifecycle__step">
            <div className="pv-lifecycle__connector">
              {i > 0 && (
                <div
                  className={`pv-lifecycle__line${isDone || isCurrent ? ' pv-lifecycle__line--done' : ''}`}
                />
              )}
              <div className={dotClass} />
              {i < PROJECT_LIFECYCLE.length - 1 && (
                <div
                  className={`pv-lifecycle__line${isDone ? ' pv-lifecycle__line--done' : ''}`}
                />
              )}
            </div>
            <span className={labelClass}>{step}</span>
          </div>
        );
      })}
      {isBlocked && (
        <div className="pv-lifecycle__step">
          <div className="pv-lifecycle__connector">
            <div className="pv-lifecycle__line" />
            <div className="pv-lifecycle__dot pv-lifecycle__dot--blocked" />
          </div>
          <span className="pv-lifecycle__label pv-lifecycle__label--danger">
            {m.projects_stepper_blocked_chip()}
          </span>
        </div>
      )}
    </div>
  );
}
