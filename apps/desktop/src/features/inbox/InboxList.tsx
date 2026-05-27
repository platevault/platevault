/**
 * InboxList -- list items rendered within the ListSidebar using ListItem.
 * Each item shows: target name, date, filter, integration time.
 * No confidence scores. Uses shared format utilities.
 * Rewritten per spec 030.
 */

import { Pill } from '@/ui';
import { ListItem } from '@/components';
import { formatIntegration, formatBytes } from '@/lib/format';
import type { InboxSession } from './mock-data';

export interface InboxListProps {
  sessions: InboxSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function InboxList({ sessions, selectedId, onSelect }: InboxListProps) {
  if (sessions.length === 0) {
    return (
      <div className="alm-list-sidebar__empty">
        No sessions match the current filters.
      </div>
    );
  }

  return (
    <>
      {sessions.map((session) => (
        <ListItem
          key={session.id}
          id={session.id}
          selected={selectedId === session.id}
          onSelect={onSelect}
        >
          <div className="alm-list-item__row">
            <span className="alm-list-item__name">
              {session.object}
            </span>
            {session.filter && (
              <Pill label={session.filter} variant="ghost" size="sm" />
            )}
          </div>
          <div className="alm-list-item__meta">
            <span>{session.date}</span>
            <span className="alm-list-item__dot" />
            <span>{formatIntegration(session.totalIntegrationSeconds)}</span>
            <span className="alm-list-item__dot" />
            <span>{formatBytes(session.totalSizeBytes)}</span>
          </div>
          <div className="alm-list-item__meta">
            <Pill label={session.frameType} variant="neutral" size="sm" />
            <span>{session.frameCount} frames</span>
          </div>
        </ListItem>
      ))}
    </>
  );
}
