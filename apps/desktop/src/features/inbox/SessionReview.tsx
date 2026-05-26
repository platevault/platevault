/**
 * T048 — SessionReview: detail view for a selected inbox session.
 *
 * Header with session name (via session-naming.ts), PropertyTable in edit mode
 * with source indicators and confirm checkboxes, frames summary, and conflict
 * warnings (via conflict-detection.ts).
 */

import { useMemo, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Section, Pill } from '@/ui';
import { PropertyTable } from '@/components';
import type { PropertyDef } from '@/components';
import { formatSessionName } from './session-naming';
import { detectConflicts } from './conflict-detection';
import { toFrameProperties } from './mock-data';
import type { InboxSession } from './mock-data';

function formatIntegration(seconds: number): string {
  if (seconds < 1) return '<1s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export interface SessionReviewProps {
  session: InboxSession;
}

export function SessionReview({ session }: SessionReviewProps) {
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const prop of session.properties) {
      if (prop.confirmed) initial.add(prop.key);
    }
    return initial;
  });

  const sessionName = useMemo(
    () =>
      formatSessionName({
        frameType: session.frameType,
        object: session.object,
        date: session.date,
        filter: session.filter || undefined,
        setTemp: session.setTemp ?? undefined,
      }),
    [session],
  );

  const conflicts = useMemo(
    () => detectConflicts(toFrameProperties(session)),
    [session],
  );

  const toggleConfirm = useCallback((key: string) => {
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const propertyDefs: PropertyDef[] = useMemo(
    () =>
      session.properties.map((prop) => ({
        key: prop.key,
        label: prop.label,
        value: prop.value,
        editable: prop.editable,
        source: prop.source,
        confirmed: confirmedKeys.has(prop.key),
        onConfirmToggle: () => toggleConfirm(prop.key),
      })),
    [session.properties, confirmedKeys, toggleConfirm],
  );

  return (
    <div className="alm-session-review">
      {/* Header */}
      <header className="alm-session-review__header">
        <h2 className="alm-session-review__title">{sessionName}</h2>
        <div className="alm-session-review__badges">
          <Pill label={session.frameType} variant="neutral" />
          {session.filter && <Pill label={session.filter} variant="info" />}
        </div>
      </header>

      {/* Conflict warnings */}
      {conflicts.hasConflicts && (
        <div className="alm-session-review__conflicts" role="alert">
          <div className="alm-session-review__conflicts-header">
            <Pill label="Conflicts Detected" variant="warn" />
          </div>
          <ul className="alm-session-review__conflicts-list">
            {conflicts.details.map((detail) => (
              <li key={detail} className="alm-session-review__conflict-item">
                {detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Properties */}
      <Section title="Properties">
        <PropertyTable
          properties={propertyDefs}
          mode="edit"
          showSource
          showConfirm
        />
      </Section>

      {/* Frames summary */}
      <Section title="Frames">
        <div className="alm-session-review__frames">
          <div className="alm-session-review__frames-grid">
            <div className="alm-session-review__frames-stat">
              <span className="alm-session-review__frames-label">Count</span>
              <span className="alm-session-review__frames-value">
                {session.frameCount}
              </span>
            </div>
            <div className="alm-session-review__frames-stat">
              <span className="alm-session-review__frames-label">
                Total Integration
              </span>
              <span className="alm-session-review__frames-value">
                {formatIntegration(session.totalIntegrationSeconds)}
              </span>
            </div>
            <div className="alm-session-review__frames-stat">
              <span className="alm-session-review__frames-label">
                Total Size
              </span>
              <span className="alm-session-review__frames-value">
                {formatSize(session.totalSizeBytes)}
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Path info */}
      <Section title="Location" defaultOpen={false}>
        <div className="alm-session-review__location">
          <div className={clsx('alm-session-review__path-row')}>
            <span className="alm-session-review__path-label">Root</span>
            <code className="alm-session-review__path-value">
              {session.rootPath}
            </code>
          </div>
          <div className="alm-session-review__path-row">
            <span className="alm-session-review__path-label">Path</span>
            <code className="alm-session-review__path-value">
              {session.relativePath}
            </code>
          </div>
        </div>
      </Section>
    </div>
  );
}
