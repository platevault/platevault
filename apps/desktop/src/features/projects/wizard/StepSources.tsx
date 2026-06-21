import { useState, useMemo } from 'react';
import { Checkbox } from '@base-ui-components/react/checkbox';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { listSessions } from '@/api/commands';

import { formatIntegration } from '@/lib/format';

export interface StepSourcesData {
  selectedSessionIds: string[];
}

export interface StepSourcesProps {
  data: StepSourcesData;
  onChange: (data: StepSourcesData) => void;
}

export function StepSources({ data, onChange }: StepSourcesProps) {
  const { data: sessions, isFetching: loading } = useQuery({
    queryKey: queryKeys.sessions.all(),
    queryFn: () => listSessions(),
  });
  const [filterTarget, setFilterTarget] = useState('');
  const [filterFilter, setFilterFilter] = useState('');

  const filtered = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => {
      if (filterTarget && !s.sessionKey.target.toLowerCase().includes(filterTarget.toLowerCase())) return false;
      if (filterFilter && !s.sessionKey.filter.toLowerCase().includes(filterFilter.toLowerCase())) return false;
      // Only show confirmed sessions
      return s.state === 'confirmed';
    });
  }, [sessions, filterTarget, filterFilter]);

  const totalIntegration = useMemo(() => {
    if (!sessions) return 0;
    return sessions
      .filter((s) => data.selectedSessionIds.includes(s.id))
      .reduce((acc, s) => acc + (s.totalIntegrationSeconds ?? 0), 0);
  }, [sessions, data.selectedSessionIds]);

  function toggleSession(id: string) {
    const selected = new Set(data.selectedSessionIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    onChange({ selectedSessionIds: Array.from(selected) });
  }

  function toggleAll() {
    if (filtered.length === data.selectedSessionIds.length) {
      onChange({ selectedSessionIds: [] });
    } else {
      onChange({ selectedSessionIds: filtered.map((s) => s.id) });
    }
  }

  if (loading) {
    return <div className="alm-wizard-sources__loading">Loading sessions...</div>;
  }

  return (
    <div className="alm-wizard-sources">
      {/* Filter row */}
      <div className="alm-wizard-sources__filter-row">
        <input
          type="text"
          placeholder="Filter by target..."
          value={filterTarget}
          onChange={(e) => setFilterTarget(e.target.value)}
          className="alm-wizard-sources__filter-input"
        />
        <input
          type="text"
          placeholder="Filter by filter..."
          value={filterFilter}
          onChange={(e) => setFilterFilter(e.target.value)}
          className="alm-wizard-sources__filter-input"
        />
      </div>

      {/* Summary */}
      <div className="alm-wizard-sources__summary">
        <span><strong>{data.selectedSessionIds.length}</strong> sessions selected</span>
        <span>Total integration: <strong>{formatIntegration(totalIntegration)}</strong></span>
      </div>

      {/* Session list */}
      <div className="alm-wizard-sources__list">
        {/* Header */}
        <div className="alm-wizard-sources__list-header">
          <Checkbox.Root
            className="alm-checkbox"
            checked={filtered.length > 0 && data.selectedSessionIds.length === filtered.length}
            onCheckedChange={toggleAll}
            aria-label="Select all sessions"
          >
            <Checkbox.Indicator className="alm-checkbox__indicator">
              &#x2713;
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span>Target / Filter / Night</span>
          <span>Frames</span>
          <span>Integration</span>
          <span>Train</span>
        </div>

        {/* Rows */}
        {filtered.map((session) => (
          <label
            key={session.id}
            className="alm-wizard-sources__row"
            style={{
              background: data.selectedSessionIds.includes(session.id) ? 'var(--alm-surface)' : 'transparent',
            }}
          >
            <Checkbox.Root
              className="alm-checkbox"
              checked={data.selectedSessionIds.includes(session.id)}
              onCheckedChange={() => toggleSession(session.id)}
              aria-label={`Select ${session.sessionKey.target} session`}
            >
              <Checkbox.Indicator className="alm-checkbox__indicator">
                &#x2713;
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span>
              {session.sessionKey.target} / {session.sessionKey.filter} / {session.sessionKey.night}
            </span>
            <span>{session.frameCount}</span>
            <span>{formatIntegration(session.totalIntegrationSeconds ?? 0)}</span>
            <span className="alm-wizard-sources__train-id">
              {session.opticalTrainId.slice(0, 8)}
            </span>
          </label>
        ))}

        {filtered.length === 0 && (
          <div className="alm-wizard-sources__empty">
            No confirmed sessions match filters
          </div>
        )}
      </div>
    </div>
  );
}
