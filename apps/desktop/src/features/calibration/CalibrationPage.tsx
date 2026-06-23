/**
 * CalibrationPage — spec 007 wired; spec 043 §4 redesign + shared layout-system
 * adoption (tasks #62/#63/#73).
 *
 * Adopts the Sessions REFERENCE layout: a pinned `PageTopBar` over a
 * `ListPageLayout` body — a dense FULL-WIDTH sortable masters table
 * (MastersTable, grouped by Kind) as primary, with the existing MasterDetail
 * (fingerprint rail + compatible-sessions match table) hosted in the right-side
 * detail pane that mounts on selection.
 *
 * Top-bar convention (task #80): the bar carries ONLY page-level controls —
 * search + group-by. The page title and per-kind counts are intentionally
 * omitted (the left nav names the page; counts move to the bottom status bar).
 * Sorting is via clickable table-column headers, not a toolbar sort control.
 * Per-master actions ("Use in project" / "Reveal in Explorer") live in the
 * detail panel header (MasterDetail), since they act on the selected master.
 *
 * URL state: `?selected=<master-id>` (string UUID from the real backend).
 */

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import { m } from '@/lib/i18n';
import type { FilterOption } from '@/components';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { MasterDetail } from './MasterDetail';
import {
  MastersTable,
  DEFAULT_MASTER_SORT,
  DEFAULT_MASTER_GROUP_BY,
} from './MastersTable';
import type { MasterSort, MasterSortCol, MasterGroupBy } from './MastersTable';
import { useCalibrationMasters, useCalibrationSettings } from './useCalibration';

// ── Toolbar vocab ─────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS: FilterOption[] = [{ value: 'kind', label: m.calibration_fp_kind() }];

// ── Component ─────────────────────────────────────────────────────────────────

export function CalibrationPage() {
  const { selected } = useSearch({ from: '/shell/calibration' });
  const navigate = useNavigate({ from: '/calibration' });
  const { masters, loading, error } = useCalibrationMasters();
  const { prefillSuggestion, agingThresholdDays } = useCalibrationSettings();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<MasterSort>(DEFAULT_MASTER_SORT);
  // Group-by is fixed to Kind in v1 (only meaningful grouping); the control is
  // still surfaced for layout consistency with the other list pages.
  const [groupBy, setGroupBy] = useState<MasterGroupBy>(DEFAULT_MASTER_GROUP_BY);

  const master = masters.find((m) => m.id === selected) ?? null;

  // (task #87) The per-page status-bar summary (master/dark/flat/bias counts)
  // was removed: the status bar now shows GLOBAL library totals via
  // useStatusSummary, not per-route counts.

  const clearSelection = useCallback(
    () => navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );
  useStaleSelectionCleanup(selected, master !== null, clearSelection);

  const onSelect = (id: string) =>
    navigate({ search: (prev) => ({ ...prev, selected: id }) });

  // Sorting is header-driven: clicking a column toggles direction or switches column.
  const handleSort = useCallback((col: MasterSortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  }, []);

  // Client-side text search across the visible master fields.
  const q = search.trim().toLowerCase();
  const visibleMasters =
    q === ''
      ? masters
      : masters.filter((m) => {
          const fp = m.fingerprint;
          const haystack = [
            m.kind,
            fp?.camera,
            fp?.filter,
            fp?.binning,
            fp?.gain != null ? `g${fp.gain}` : '',
            fp?.exposureS != null ? `${fp.exposureS}s` : '',
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        });

  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: m.calibration_search_masters_placeholder(),
            ariaLabel: m.calibration_search_masters_aria(),
          }}
          groupBy={{
            value: groupBy,
            options: GROUP_BY_OPTIONS,
            onChange: (v) => setGroupBy(v as MasterGroupBy),
          }}
        />
      }
    />
  );

  return (
    <ListPageLayout
      topBar={topBar}
      detail={
        master != null ? (
          <MasterDetail
            master={master}
            prefillSuggestion={prefillSuggestion}
            agingThresholdDays={agingThresholdDays}
          />
        ) : undefined
      }
      onCloseDetail={master != null ? clearSelection : undefined}
      detailLabel="Master details"
    >
      <MastersTable
        masters={visibleMasters}
        loading={loading}
        error={error}
        selected={selected ?? null}
        onSelect={onSelect}
        sort={sort}
        onSort={handleSort}
        agingThresholdDays={agingThresholdDays}
      />
    </ListPageLayout>
  );
}
