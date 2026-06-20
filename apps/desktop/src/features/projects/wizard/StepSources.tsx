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
    return <div style={{ color: 'var(--alm-text-muted)' }}>Loading sessions...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-4)' }}>
      {/* Filter row */}
      <div style={{ display: 'flex', gap: 'var(--alm-space-2)' }}>
        <input
          type="text"
          placeholder="Filter by target..."
          value={filterTarget}
          onChange={(e) => setFilterTarget(e.target.value)}
          style={{
            padding: 'var(--alm-space-1) var(--alm-space-2)',
            border: '1px solid var(--alm-border)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-xs)',
            background: 'var(--alm-surface)',
            color: 'var(--alm-text)',
          }}
        />
        <input
          type="text"
          placeholder="Filter by filter..."
          value={filterFilter}
          onChange={(e) => setFilterFilter(e.target.value)}
          style={{
            padding: 'var(--alm-space-1) var(--alm-space-2)',
            border: '1px solid var(--alm-border)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-xs)',
            background: 'var(--alm-surface)',
            color: 'var(--alm-text)',
          }}
        />
      </div>

      {/* Summary */}
      <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', display: 'flex', gap: 'var(--alm-space-4)' }}>
        <span><strong>{data.selectedSessionIds.length}</strong> sessions selected</span>
        <span>Total integration: <strong>{formatIntegration(totalIntegration)}</strong></span>
      </div>

      {/* Session list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--alm-border)', borderRadius: 6, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 80px 80px 100px',
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            background: 'var(--alm-surface)',
            borderBottom: '1px solid var(--alm-border)',
            fontSize: 'var(--alm-text-xs)',
            fontWeight: 600,
            color: 'var(--alm-text-muted)',
          }}
        >
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
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr 80px 80px 100px',
              padding: 'var(--alm-space-2) var(--alm-space-3)',
              borderBottom: '1px solid var(--alm-border)',
              fontSize: 'var(--alm-text-xs)',
              cursor: 'pointer',
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
            <span style={{ fontFamily: 'var(--alm-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {session.opticalTrainId.slice(0, 8)}
            </span>
          </label>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: 'var(--alm-space-4)', textAlign: 'center', color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
            No confirmed sessions match filters
          </div>
        )}
      </div>
    </div>
  );
}
