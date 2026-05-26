import { useMemo, useState, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { listSessions } from '@/api/commands';
import type { AcquisitionSession } from '@/bindings/types';
import { ThreePane, Toolbar, Btn, EmptyState } from '@/ui';
import { SessionsList } from './SessionsList';
import { SessionDetailInline } from './SessionDetail';
import { SessionInspector } from './SessionInspector';
import { CalendarView } from './CalendarView';

const sessionsStore = createQueryStore(() => listSessions());

export function SessionsPage() {
  const { data, loading } = useQuery(sessionsStore);
  const [view, setView] = usePreference('sessionsView');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Support opening a specific session via URL search params (e.g. /sessions?selected=xxx)
  const searchParams = useSearch({ strict: false }) as Record<string, string> | undefined;
  const selectedFromUrl = (searchParams as Record<string, string> | undefined)?.selected;

  // If URL has a selected param, use it on mount
  useEffect(() => {
    if (selectedFromUrl && !selectedId) {
      setSelectedId(selectedFromUrl);
    }
  }, [selectedFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = data ?? [];

  // Filter data by selected day (from calendar)
  const filteredSessions = useMemo(() => {
    if (!selectedDay) return sessions;
    return sessions.filter((s) => s.session_key.night === selectedDay);
  }, [sessions, selectedDay]);

  // Find the selected session object
  const selectedSession = useMemo(() => {
    if (!selectedId) return null;
    return sessions.find((s) => s.id === selectedId) ?? null;
  }, [sessions, selectedId]);

  // Session counts for the toolbar sub-bar
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

  const viewToggle = (
    <>
      <Btn size="sm" active={!isCalendar} onClick={() => setView('list')}>
        List
      </Btn>
      <Btn size="sm" active={isCalendar} onClick={() => setView('calendar')}>
        Calendar
      </Btn>
    </>
  );

  const subBar = (
    <div className="alm-sessions-sub">
      <span className="alm-sessions-sub__counts">
        <span>{counts.total} sessions</span>
        <span className="alm-sessions-sub__dot">&middot;</span>
        <span>{counts.confirmed} confirmed</span>
        <span className="alm-sessions-sub__dot">&middot;</span>
        <span>{counts.needsReview} needs review</span>
      </span>
      <span className="alm-sessions-sub__keys">
        n = new session &middot; &#x23CE; open &middot; &#x2318;D dupe in project
      </span>
    </div>
  );

  // Calendar view uses the full page
  if (isCalendar) {
    return (
      <div className="alm-page">
        <Toolbar subBar={subBar}>{viewToggle}</Toolbar>
        <CalendarView
          onDaySelect={(day) => {
            setSelectedDay(day);
            setView('list');
          }}
        />
      </div>
    );
  }

  // 3-pane list view
  return (
    <div className="alm-page">
      <Toolbar subBar={subBar}>{viewToggle}</Toolbar>

      {selectedDay && (
        <div className="alm-page__filter-bar">
          <span>Filtered by night: {selectedDay}</span>
          <Btn size="sm" variant="ghost" onClick={() => setSelectedDay(null)}>
            Clear
          </Btn>
        </div>
      )}

      <ThreePane
        listWidth={280}
        detailWidth={320}
        list={
          <SessionsList
            sessions={filteredSessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
        content={
          selectedSession ? (
            <SessionDetailInline session={selectedSession} />
          ) : (
            <div className="alm-session-detail-empty">
              <EmptyState
                title="Select a session"
                description="Choose a session from the list to view its details."
              />
            </div>
          )
        }
        detail={
          selectedSession ? (
            <SessionInspector session={selectedSession} />
          ) : (
            <div className="alm-session-detail-empty">
              <div
                style={{
                  padding: 'var(--alm-space-6)',
                  color: 'var(--alm-text-muted)',
                  fontSize: 'var(--alm-text-sm)',
                }}
              >
                Select a session to see quick info and actions.
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
