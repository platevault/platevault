/**
 * T046 — InboxPage: full inbox session review page.
 *
 * Layout: Left (ListSidebar with InboxList), Center (SessionReview detail),
 * Right (ActionSidebar). Uses ThreePane for the three-column layout.
 * Mock data from ./mock-data — no Tauri data fetching.
 */

import { useState, useMemo, useCallback } from 'react';
import { ThreePane, EmptyState } from '@/ui';
import { ListSidebar } from '@/components';
import { InboxList } from './InboxList';
import { SessionReview } from './SessionReview';
import { ActionSidebar } from './ActionSidebar';
import { SplitPreview } from './SplitPreview';
import { MergeSearch } from './MergeSearch';
import { InboxConfirmOverlay } from './InboxConfirmOverlay';
import { FilterSelect } from './FilterSelect';
import { MOCK_INBOX_SESSIONS } from './mock-data';
import type { InboxSession } from './mock-data';
import type { InboxAction } from './ActionSidebar';

type SortMode = 'date_desc' | 'date_asc' | 'frames_desc' | 'name_asc';
type GroupMode = 'none' | 'type' | 'date' | 'filter';

const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'type', label: 'Frame type' },
  { value: 'date', label: 'Date' },
  { value: 'filter', label: 'Filter' },
];

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'frames_desc', label: 'Frames (most)' },
  { value: 'name_asc', label: 'Name (A-Z)' },
];

const TYPE_PILLS = [
  { value: 'light', label: 'Lights', active: false },
  { value: 'dark', label: 'Darks', active: false },
  { value: 'flat', label: 'Flats', active: false },
  { value: 'bias', label: 'Bias', active: false },
];

function sortSessions(sessions: InboxSession[], mode: SortMode): InboxSession[] {
  const arr = [...sessions];
  switch (mode) {
    case 'date_desc':
      arr.sort((a, b) => b.date.localeCompare(a.date));
      break;
    case 'date_asc':
      arr.sort((a, b) => a.date.localeCompare(b.date));
      break;
    case 'frames_desc':
      arr.sort((a, b) => b.frameCount - a.frameCount);
      break;
    case 'name_asc':
      arr.sort((a, b) => a.object.localeCompare(b.object));
      break;
  }
  return arr;
}

export function InboxPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupMode>('none');
  const [sortMode, setSortMode] = useState<SortMode>('date_desc');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [filterFilter, setFilterFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Overlay states
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  const sessions = MOCK_INBOX_SESSIONS;

  // Filter
  const filtered = useMemo(() => {
    let result = sessions;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.object.toLowerCase().includes(q) ||
          s.filter.toLowerCase().includes(q) ||
          s.frameType.toLowerCase().includes(q),
      );
    }

    if (typeFilters.size > 0) {
      result = result.filter((s) => typeFilters.has(s.frameType));
    }

    if (filterFilter) {
      result = result.filter((s) => s.filter === filterFilter);
    }

    return result;
  }, [sessions, searchQuery, typeFilters, filterFilter]);

  // Sort
  const sorted = useMemo(
    () => sortSessions(filtered, sortMode),
    [filtered, sortMode],
  );

  // Selected session
  const selectedSession = useMemo(() => {
    if (!selectedId) return null;
    return sessions.find((s) => s.id === selectedId) ?? null;
  }, [sessions, selectedId]);

  // Filter pills with active state
  const pillState = useMemo(
    () =>
      TYPE_PILLS.map((p) => ({
        ...p,
        active: typeFilters.has(p.value),
      })),
    [typeFilters],
  );

  const handleFilterToggle = useCallback((value: string) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const handleAction = useCallback(
    (action: InboxAction) => {
      if (!selectedSession) return;

      switch (action) {
        case 'confirm':
          setShowConfirm(true);
          break;
        case 'reject':
          // In mock mode, just deselect
          setSelectedId(null);
          break;
        case 'split':
          setShowSplit(true);
          break;
        case 'merge':
          setShowMerge(true);
          break;
        case 'edit':
          // Edit mode is already the default in SessionReview
          break;
      }
    },
    [selectedSession],
  );

  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    setSelectedId(null);
  }, []);

  const handleSplit = useCallback(() => {
    setShowSplit(false);
    setSelectedId(null);
  }, []);

  const handleMerge = useCallback(
    (_mergeTargetId: string) => {
      setShowMerge(false);
      setSelectedId(null);
    },
    [],
  );

  return (
    <div className="alm-page alm-inbox-page">
      {/* Filter select above the three-pane layout */}
      <div className="alm-inbox-page__toolbar">
        <FilterSelect value={filterFilter} onChange={setFilterFilter} />
      </div>

      <ThreePane
        listWidth={280}
        detailWidth={220}
        list={
          <ListSidebar
            searchPlaceholder="Search inbox..."
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            groupOptions={GROUP_OPTIONS}
            groupValue={groupBy}
            onGroupChange={(v) => setGroupBy(v as GroupMode)}
            sortOptions={SORT_OPTIONS}
            sortValue={sortMode}
            onSortChange={(v) => setSortMode(v as SortMode)}
            filterPills={pillState}
            onFilterToggle={handleFilterToggle}
            itemCount={sorted.length}
          >
            <InboxList
              sessions={sorted}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ListSidebar>
        }
        content={
          selectedSession ? (
            <SessionReview session={selectedSession} />
          ) : (
            <EmptyState
              title="Select a session"
              description="Choose a session from the inbox to review its properties and confirm or adjust before organizing."
            />
          )
        }
        detail={
          <ActionSidebar
            hasSelection={selectedId !== null}
            onAction={handleAction}
          />
        }
      />

      {/* Overlays */}
      {selectedSession && (
        <>
          <InboxConfirmOverlay
            open={showConfirm}
            session={selectedSession}
            onConfirm={handleConfirm}
            onCancel={() => setShowConfirm(false)}
          />
          <SplitPreview
            open={showSplit}
            session={selectedSession}
            onConfirm={handleSplit}
            onCancel={() => setShowSplit(false)}
          />
          <MergeSearch
            open={showMerge}
            currentSession={selectedSession}
            allSessions={sessions}
            onConfirm={handleMerge}
            onCancel={() => setShowMerge(false)}
          />
        </>
      )}
    </div>
  );
}
