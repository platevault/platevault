/**
 * SessionsPage -- list-detail layout with ListSidebar-based SessionsList
 * and TopActionBar. No right sidebar (removed per spec 030).
 * Calendar view remains as a full-page alternate.
 */

import { useMemo, useState, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { listSessions } from '@/api/commands';
import type { AcquisitionSession } from '@/bindings/types';
import { EmptyState, Btn } from '@/ui';
import { TopActionBar } from '@/components';
import { SessionsList } from './SessionsList';
import { SessionDetailInline } from './SessionDetail';
import { CalendarView } from './CalendarView';

const sessionsStore = createQueryStore(() => listSessions());

export function SessionsPage() {
  const { data, loading } = useQuery(sessionsStore);
  const [view, setView] = usePreference('sessionsView');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const searchParams = useSearch({ strict: false }) as Record<string, string> | undefined;
  const selectedFromUrl = (searchParams as Record<string, string> | undefined)?.selected;

  useEffect(() => {
    if (selectedFromUrl && !selectedId) {
      setSelectedId(selectedFromUrl);
    }
  }, [selectedFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = data ?? [];

  const filteredSessions = useMemo(() => {
    if (!selectedDay) return sessions;
    return sessions.filter((s) => s.session_key.night === selectedDay);
  }, [sessions, selectedDay]);

  const selectedSession = useMemo(() => {
    if (!selectedId) return null;
    return sessions.find((s) => s.id === selectedId) ?? null;
  }, [sessions, selectedId]);

  const counts = useMemo(() => {
    return {
      total: sessions.length,
      confirmed: sessions.filter((s) => s.state === 'confirmed').length,
      needsReview: sessions.filter((s) => s.state === 'needs_review').length,
    };
  }, [sessions]);

  if (loading) {
    return <div className="alm-page__loading">Loading sessions...</div>;
  }

  const isCalendar = view === 'calendar';

  const actions = [
    {
      label: isCalendar ? 'List' : 'Calendar',
      variant: 'ghost' as const,
      onClick: () => setView(isCalendar ? 'list' : 'calendar'),
    },
  ];

  if (isCalendar) {
    return (
      <div className="alm-page" data-testid="SessionsPage">
        <TopActionBar
          title="Sessions"
          subtitle={`${counts.total} sessions · ${counts.confirmed} confirmed · ${counts.needsReview} needs review`}
          actions={actions}
        />
        <CalendarView
          onDaySelect={(day) => {
            setSelectedDay(day);
            setView('list');
          }}
        />
      </div>
    );
  }

  return (
    <div className="alm-page" data-testid="SessionsPage">
      <TopActionBar
        title="Sessions"
        subtitle={`${counts.total} sessions · ${counts.confirmed} confirmed · ${counts.needsReview} needs review`}
        actions={actions}
      />

      {selectedDay && (
        <div className="alm-page__filter-bar">
          <span>Filtered by night: {selectedDay}</span>
          <Btn size="sm" variant="ghost" onClick={() => setSelectedDay(null)}>
            Clear
          </Btn>
        </div>
      )}

      <div className="alm-list-detail-layout">
        <div className="alm-list-detail-layout__list">
          <SessionsList
            sessions={filteredSessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="alm-list-detail-layout__detail">
          {selectedSession ? (
            <SessionDetailInline session={selectedSession} />
          ) : (
            <EmptyState
              title="Select a session"
              description="Choose a session from the list to view its details."
            />
          )}
        </div>
      </div>
    </div>
  );
}
