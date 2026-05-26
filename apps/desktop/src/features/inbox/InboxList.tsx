/**
 * T047 — InboxList: list items rendered within the ListSidebar.
 *
 * Each item shows: target name, date, filter, integration time.
 * No confidence scores. Selected state styling via BEM.
 */

import { clsx } from 'clsx';
import { Pill } from '@/ui';
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

export interface InboxListProps {
  sessions: InboxSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function InboxList({ sessions, selectedId, onSelect }: InboxListProps) {
  if (sessions.length === 0) {
    return (
      <div className="alm-inbox-list__empty">
        No sessions match the current filters.
      </div>
    );
  }

  return (
    <>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          role="option"
          aria-selected={selectedId === session.id}
          className={clsx(
            'alm-inbox-list__item',
            selectedId === session.id && 'alm-inbox-list__item--selected',
          )}
          onClick={() => onSelect(session.id)}
        >
          <div className="alm-inbox-list__item-top">
            <span className="alm-inbox-list__item-target">
              {session.object}
            </span>
            {session.filter && (
              <Pill label={session.filter} variant="ghost" size="sm" />
            )}
          </div>
          <div className="alm-inbox-list__item-meta">
            <span className="alm-inbox-list__item-date">{session.date}</span>
            <span className="alm-inbox-list__item-dot" />
            <span className="alm-inbox-list__item-integration">
              {formatIntegration(session.totalIntegrationSeconds)}
            </span>
            <span className="alm-inbox-list__item-dot" />
            <span className="alm-inbox-list__item-size">
              {formatSize(session.totalSizeBytes)}
            </span>
          </div>
          <div className="alm-inbox-list__item-bottom">
            <Pill label={session.frameType} variant="neutral" size="sm" />
            <span className="alm-inbox-list__item-frames">
              {session.frameCount} frames
            </span>
          </div>
        </button>
      ))}
    </>
  );
}
