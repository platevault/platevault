/**
 * SessionsPage — spec 006 wired; spec 043 §4 redesign (task #36) + shared
 * layout-system adoption (tasks #62/#63/#73).
 *
 * The Sessions page is the inventory ledger and the REFERENCE adoption of the
 * shared list-page system: a pinned `PageTopBar` (title + `FilterToolbar`)
 * over a `ListPageLayout` body — a dense full-width sortable table
 * (SessionsTable) on the left and the existing SessionDetail in a bottom
 * detail pane that mounts on selection.
 *
 * Toolbar (spec 043 §4): search + Group-by control (Target / Filter / Night /
 * Camera / Month). Consistent with every list page, the table is FLAT by
 * default (a single sorted list) and grouping is opt-in. The legacy
 * frame-type filter was removed — sessions are light frames.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The review-state filter (`reviewFilter`) and the contextual
 * Confirm / Re-open / Reject / Ignore actions in the SessionDetail header were
 * removed along with the review-state machine. The Reveal action (FR-007) is
 * unrelated to the review lifecycle and is retained.
 *
 * URL state (extends spec 020):
 *   selected     — string session UUID
 *   sourceFilter — optional LibraryRoot UUID or 'all'
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { useGrouping } from '@/lib/use-grouping';
import {
  SessionsTable,
  DEFAULT_SESSION_SORT,
} from './SessionsTable';
import type { SessionSort, SessionSortCol } from './SessionsTable';
import { SessionDetail } from './SessionDetail';
import {
  useInventorySources,
  type InventoryFilters,
} from './store';
import { addToast } from '@/shared/toast';
import { m } from '@/lib/i18n';
import { revealInventoryPath } from './revealInventory';
import type { InventorySource } from '@/bindings/index';

/** Client-side text search across the visible session fields. */
function filterSourcesBySearch(sources: InventorySource[], query: string): InventorySource[] {
  const q = query.trim().toLowerCase();
  if (!q) return sources;
  const matches = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q);
  return sources
    .map((src) => ({
      ...src,
      sessions: src.sessions.filter(
        (s) =>
          matches(s.target) ||
          matches(s.name) ||
          matches(s.filter) ||
          matches(s.camera),
      ),
    }))
    .filter((src) => src.sessions.length > 0);
}

export function SessionsPage() {
  const { selected, sourceFilter } = useSearch({
    from: '/shell/sessions',
  });
  const navigate = useNavigate({ from: '/sessions' });

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);

  const { dims, setSlot } = useGrouping({
    storageKey: 'sessions.grouping.dims.v1',
    validIds: ['target', 'filter', 'night', 'camera', 'month'],
    defaultDims: [],
  });

  const SESSION_DIMENSIONS: FilterOption[] = [
    { value: 'target', label: m.projects_create_target_label() },
    { value: 'filter', label: m.common_filter() },
    { value: 'night', label: m.sessions_col_night() },
    { value: 'camera', label: m.settings_calmatch_camera() },
    { value: 'month', label: m.sessions_dim_month() },
  ];

  // Build filters from URL params and pass directly to useInventorySources.
  const filters: InventoryFilters = {};
  if (sourceFilter && sourceFilter !== 'all') filters.sourceFilter = sourceFilter;

  const { data: response, loading, error } = useInventorySources(filters);

  const sources = useMemo(
    () => filterSourcesBySearch(response?.sources ?? [], search),
    [response?.sources, search],
  );

  // (task #87) The per-page status-bar summary (session/confirmed/needs-review
  // counts) was removed: the status bar now shows GLOBAL library totals via
  // useStatusSummary, not per-route counts.

  // Flatten all sessions across sources to find the selected one.
  const allSessions = response?.sources.flatMap((src) => src.sessions) ?? [];
  const selectedSession = selected != null ? allSessions.find((s) => s.id === selected) : undefined;

  // Resolve the selected session's owning source path for the Reveal action
  // (FR-007) — sessions carry only `sourceId`; the path lives on the source.
  const selectedSourcePath =
    selectedSession != null
      ? response?.sources.find((src) => src.id === selectedSession.sourceId)?.path
      : undefined;

  // Clear stale selection when the session disappears after a filter change.
  const clearSelection = useCallback(
    () =>
      navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );
  useStaleSelectionCleanup(selected, selectedSession !== undefined, clearSelection);

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  const handleSort = useCallback((col: SessionSortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  }, []);

  // Reveal the session's source location in the OS file browser (FR-007).
  const handleReveal = useCallback(async () => {
    if (!selected || !selectedSourcePath) return;
    try {
      await revealInventoryPath({ path: selectedSourcePath, sessionId: selected });
    } catch {
      addToast({ message: m.sessions_toast_reveal_error(), variant: 'error' });
    }
  }, [selected, selectedSourcePath]);

  const revealVisible = selectedSourcePath != null;

  // Top-bar convention (task #80): NO title + NO summary (the left nav names
  // the page; the count/metadata lives in the bottom status bar) and NO sort
  // control (sorting is driven by the clickable SessionsTable column headers).
  // The bar carries only search + Group-by (spec 041 FR-051: the review-state
  // filter was removed along with the review lifecycle).
  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: m.sessions_search_placeholder(),
            ariaLabel: m.sessions_search_aria(),
          }}
          grouping={{
            dimensions: SESSION_DIMENSIONS,
            dims,
            setSlot,
          }}
        />
      }
    />
  );

  return (
    <ListPageLayout
      topBar={topBar}
      detail={
        selectedSession != null ? (
          <SessionDetail
            session={selectedSession}
            onReveal={() => void handleReveal()}
            revealVisible={revealVisible}
            onOpenProject={() => navigate({ to: '/projects' })}
          />
        ) : undefined
      }
      onCloseDetail={selectedSession != null ? clearSelection : undefined}
      detailLabel={m.cmp_listpage_close_session_details_aria()}
    >
      {error != null ? (
        <div className="alm-sessions-table__empty">{m.sessions_load_error()}</div>
      ) : (
        <SessionsTable
          sources={sources}
          selected={selected ?? null}
          onSelect={onSelect}
          loading={loading}
          sort={sort}
          onSort={handleSort}
          dims={dims}
        />
      )}
    </ListPageLayout>
  );
}
