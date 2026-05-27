/**
 * SessionsPage -- two-pane layout using PageShell + ListDetailLayout.
 * TopActionBar above the split with calendar toggle.
 * Calendar view remains as a full-page alternate.
 * Rewritten per spec 030 composition contracts.
 */

import { useMemo, useState, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { listSessions } from '@/api/commands';
import type { AcquisitionSession } from '@/bindings/types';
import { EmptyState, Btn } from '@/ui';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
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

  const isCalendar = view === 'calendar';

  const viewToggleAction = {
    label: isCalendar ? 'List' : 'Calendar',
    variant: 'ghost' as const,
    onClick: () => setView(isCalendar ? 'list' : 'calendar'),
  };

  if (isCalendar) {
    return (
      <PageShell testId="SessionsPage" loading={loading} loadingMessage="Loading sessions...">
        <TopActionBar
          title="Sessions"
          subtitle={`${counts.total} sessions · ${counts.confirmed} confirmed · ${counts.needsReview} needs review`}
          actions={[viewToggleAction]}
        />
        <CalendarView
          onDaySelect={(day) => {
            setSelectedDay(day);
            setView('list');
          }}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      testId="SessionsPage"
      loading={loading}
      loadingMessage="Loading sessions..."
      empty={{
        title: 'No sessions yet',
        description: 'Sessions appear here after scanning your library roots.',
      }}
      hasData={sessions.length > 0}
    >
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Sessions"
            subtitle={`${counts.total} sessions · ${counts.confirmed} confirmed · ${counts.needsReview} needs review`}
            actions={[viewToggleAction]}
          >
            {selectedDay && (
              <div className="alm-top-action-bar__filter-notice">
                <span>Filtered by night: {selectedDay}</span>
                <Btn size="sm" variant="ghost" onClick={() => setSelectedDay(null)}>
                  Clear
                </Btn>
              </div>
            )}
          </TopActionBar>
        }
        list={
          <SessionsList
            sessions={filteredSessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
        detail={
          selectedSession ? (
            <SessionDetailInline session={selectedSession} />
          ) : (
            <EmptyState
              title="Select a session"
              description="Choose a session from the list to view its details."
            />
          )
        }
      />
    </PageShell>
  );
}
