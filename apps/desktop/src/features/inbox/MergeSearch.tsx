/**
 * T052 — MergeSearch: shown when the user clicks Merge.
 *
 * Search input for finding compatible sessions, list of matching sessions
 * with select. Uses the shared ConfirmOverlay as the dialog shell.
 */

import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import { Pill } from '@/ui';
import { ConfirmOverlay } from '@/components';
import type { InboxSession } from './mock-data';

export interface MergeSearchProps {
  open: boolean;
  currentSession: InboxSession;
  allSessions: InboxSession[];
  onConfirm: (mergeTargetId: string) => void;
  onCancel: () => void;
}

export function MergeSearch({
  open,
  currentSession,
  allSessions,
  onConfirm,
  onCancel,
}: MergeSearchProps) {
  const [search, setSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const others = allSessions.filter((s) => s.id !== currentSession.id);

    if (!search.trim()) return others;

    const q = search.trim().toLowerCase();
    return others.filter(
      (s) =>
        s.object.toLowerCase().includes(q) ||
        s.filter.toLowerCase().includes(q) ||
        s.date.includes(q),
    );
  }, [allSessions, currentSession.id, search]);

  const handleConfirm = () => {
    if (selectedTargetId) {
      onConfirm(selectedTargetId);
      setSelectedTargetId(null);
      setSearch('');
    }
  };

  const handleCancel = () => {
    setSelectedTargetId(null);
    setSearch('');
    onCancel();
  };

  return (
    <ConfirmOverlay
      open={open}
      onClose={handleCancel}
      onConfirm={handleConfirm}
      title="Merge Session"
      description={`Select a session to merge with "${currentSession.object}".`}
      confirmLabel="Merge"
    >
      <div className="alm-merge-search">
        {/* Search input */}
        <div className="alm-merge-search__input-wrapper">
          <input
            type="search"
            className="alm-input alm-merge-search__input"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sessions to merge"
          />
        </div>

        {/* Candidate list */}
        <div
          className="alm-merge-search__list"
          role="listbox"
          aria-label="Compatible sessions"
        >
          {candidates.length === 0 && (
            <div className="alm-merge-search__empty">
              No compatible sessions found.
            </div>
          )}
          {candidates.map((session) => (
            <button
              key={session.id}
              type="button"
              role="option"
              aria-selected={selectedTargetId === session.id}
              className={clsx(
                'alm-merge-search__item',
                selectedTargetId === session.id &&
                  'alm-merge-search__item--selected',
              )}
              onClick={() => setSelectedTargetId(session.id)}
            >
              <div className="alm-merge-search__item-top">
                <span className="alm-merge-search__item-name">
                  {session.object}
                </span>
                {session.filter && (
                  <Pill label={session.filter} variant="ghost" size="sm" />
                )}
              </div>
              <div className="alm-merge-search__item-meta">
                <span>{session.date}</span>
                <span className="alm-merge-search__item-dot" />
                <span>{session.frameCount} frames</span>
                <span className="alm-merge-search__item-dot" />
                <Pill label={session.frameType} variant="neutral" size="sm" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </ConfirmOverlay>
  );
}
