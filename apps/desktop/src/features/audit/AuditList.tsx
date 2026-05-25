import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import type { AuditEntry, AuditOutcome } from '@/api/types';
import { Pill } from '@/ui';

export interface AuditListProps {
  entries: AuditEntry[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

type SortKey = 'newest' | 'oldest';

function outcomeVariant(outcome: AuditOutcome): 'ok' | 'danger' | 'warn' | 'neutral' {
  switch (outcome) {
    case 'applied':
    case 'ok':
      return 'ok';
    case 'refused':
    case 'failed':
      return 'danger';
    case 'paused':
      return 'warn';
    default:
      return 'neutral';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AuditList({ entries, selectedId, onSelect }: AuditListProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');

  // Collect unique event types for filter dropdown
  const eventTypes = useMemo(
    () => [...new Set(entries.map((e) => e.event_type))].sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    let result = entries;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_type.toLowerCase().includes(q) ||
          e.entity_id.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q),
      );
    }

    if (outcomeFilter !== 'all') {
      result = result.filter((e) => e.outcome === outcomeFilter);
    }

    if (actorFilter !== 'all') {
      result = result.filter((e) => e.actor === actorFilter);
    }

    if (eventFilter !== 'all') {
      result = result.filter((e) => e.event_type === eventFilter);
    }

    const sorted = [...result];
    if (sort === 'newest') {
      sorted.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } else {
      sorted.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    }

    return sorted;
  }, [entries, search, sort, outcomeFilter, actorFilter, eventFilter]);

  return (
    <nav className="alm-list-pane" aria-label="Audit events">
      {/* Header */}
      <div className="alm-list-pane__header">
        <div className="alm-list-pane__title">Audit log</div>
        <div className="alm-list-pane__counts">
          {entries.length} event{entries.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Search */}
      <div className="alm-list-pane__search">
        <input
          type="text"
          className="alm-list-pane__input"
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search audit events"
        />
      </div>

      {/* Sort and filter controls */}
      <div className="alm-list-pane__controls">
        <select
          className="alm-list-pane__select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort events"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <select
          className="alm-list-pane__select"
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          aria-label="Filter by outcome"
        >
          <option value="all">Outcome: all</option>
          <option value="applied">applied</option>
          <option value="ok">ok</option>
          <option value="refused">refused</option>
          <option value="failed">failed</option>
          <option value="paused">paused</option>
        </select>
        <select
          className="alm-list-pane__select"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          aria-label="Filter by actor"
        >
          <option value="all">Actor: all</option>
          <option value="user">user</option>
          <option value="system">system</option>
        </select>
        <select
          className="alm-list-pane__select"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          aria-label="Filter by event type"
        >
          <option value="all">Event: all</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Event items */}
      <div className="alm-list-pane__items">
        {filtered.length === 0 && (
          <div className="alm-list-pane__empty">No matching events</div>
        )}
        {filtered.map((entry) => {
          const isSelected = entry.id === selectedId;
          return (
            <button
              key={entry.id}
              type="button"
              className={clsx(
                'alm-list-pane__item',
                isSelected && 'alm-list-pane__item--selected',
              )}
              onClick={() => onSelect(entry.id)}
              aria-current={isSelected ? 'true' : undefined}
            >
              <div className="alm-list-pane__item-top">
                <span className="alm-list-pane__item-time alm-mono">
                  {formatTime(entry.timestamp)}
                </span>
                <Pill
                  label={entry.outcome}
                  variant={outcomeVariant(entry.outcome)}
                  size="sm"
                />
              </div>
              <div
                className={clsx(
                  'alm-list-pane__item-label',
                  isSelected && 'alm-list-pane__item-label--active',
                )}
                title={entry.event_type}
              >
                {entry.event_type}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
