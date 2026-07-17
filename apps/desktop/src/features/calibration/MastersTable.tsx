// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MastersTable — spec 043 §4 Calibration redesign (shared-layout adoption, #73).
 *
 * Replaces the old narrow `MastersList` sidebar with a DENSE, FULL-WIDTH
 * sortable table — the same surface pattern as SessionsTable (shared `Table`
 * from `@/ui`). Like every list page, the table is FLAT by default (a single
 * sorted list); grouping is opt-in via the top-bar Group-by control (Kind,
 * Camera, Filter, …), sharing the `groupByDimensions` engine + `.alm-listgroup`
 * header rows. `dark_flat` and `bad_pixel_map` are never shown in v1 (FR-001),
 * regardless of grouping.
 *
 * Columns: Master (kind · label) · Camera · Filter · Gain · Exposure · Temp ·
 * Binning · Usage · Date(created). A few fields are CONDITIONAL by kind:
 *   - Filter is only meaningful for FLATS — darks/bias render "—".
 *   - Exposure is only meaningful for DARKS — flats/bias render "—".
 * Every other absent value renders "—" (much of this is empty in the current
 * test corpus; real values arrive with the FITS-fixture work).
 *
 * Search + the Group-by control live in the persistent top bar (shared
 * PageTopBar + FilterToolbar), not inside this surface. SORTING is via the
 * clickable column headers here (the shared Table supports header nodes).
 * Selecting a row opens the existing MasterDetail in the right-side detail pane
 * on CalibrationPage; the per-master actions live in that detail panel's header.
 */

import { useMemo, type ReactNode } from 'react';
import { Pill, Table, EmptyState, Skeleton, tableIndent } from '@/ui';
import type { PillVariant, TableColumn, TableRow } from '@/ui';
import { SortHeader, ariaSortFor, renderValue } from '@/components';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import { m } from '@/lib/i18n';
import {
  groupByDimensions,
  flattenVisibleGroups,
  type DimensionAccessor,
} from '@/lib/grouping';
import { useCollapsibleGroups } from '@/lib/use-grouping';
import { masterFieldApplicability } from './master-applicability';

// ── Kind model ──────────────────────────────────────────────────────────────

type Kind = 'dark' | 'flat' | 'bias';

/**
 * The only kinds shown in v1 (FR-001): `dark_flat` / `bad_pixel_map` and any
 * other kind are filtered out at the data level, so they never appear whether
 * the table is flat or grouped.
 */
function shownKind(kind: string): Kind | null {
  const k = kind.toLowerCase();
  if (k === 'dark' || k === 'flat' || k === 'bias') return k;
  return null;
}

function kindVariant(kind: string): PillVariant {
  const map: Record<string, PillVariant> = {
    dark: 'info',
    flat: 'accent',
    bias: 'neutral',
  };
  return map[kind.toLowerCase()] ?? 'neutral';
}

// ── Sort model ──────────────────────────────────────────────────────────────────

export type MasterSortCol =
  | 'master'
  | 'camera'
  | 'filter'
  | 'gain'
  | 'exposure'
  | 'temp'
  | 'binning'
  | 'usage'
  | 'created';
export type SortDir = 'asc' | 'desc';

export interface MasterSort {
  col: MasterSortCol;
  dir: SortDir;
}

export const DEFAULT_MASTER_SORT: MasterSort = { col: 'created', dir: 'desc' };

// ── Display helpers ──────────────────────────────────────────────────────────────

/**
 * Human-readable master label: kind-capitalized + a discriminator
 * (exposure for darks, filter for flats). Mirrors the old MastersList title.
 */
function masterLabel(m: CalibrationMaster): string {
  const k = m.kind.toLowerCase();
  const kindCap = k.charAt(0).toUpperCase() + k.slice(1);
  const fp = m.fingerprint;
  const expStr = fp?.exposureS != null ? `${fp.exposureS}s` : '';
  const filterStr = fp?.filter ?? '';
  const discriminator = k === 'dark' ? expStr : k === 'flat' ? filterStr : '';
  return discriminator
    ? `Master ${kindCap} · ${discriminator}`
    : `Master ${kindCap}`;
}

/**
 * Kind-conditional cells go through the shared renderer (spec-030 Q16 /
 * FR-135–FR-137, `@/components/RenderValue`): not-applicable to this kind
 * (e.g. filter on a dark) renders blank, applicable-but-absent renders the
 * unresolved chip — never the same "—" for both, which previously hid a
 * missing filter on a real flat behind the same marker as "flats have no
 * filter field."
 */

/** Filter only applies to flats (data-model.md matrix). */
function filterCell(m: CalibrationMaster): ReactNode {
  return renderValue(m.fingerprint?.filter ?? null, {
    applicability: masterFieldApplicability(m.kind, 'filter'),
  });
}

/** Exposure applies to darks/flats, not bias (data-model.md matrix). */
function exposureCell(m: CalibrationMaster): ReactNode {
  return renderValue(
    m.fingerprint?.exposureS ?? null,
    { applicability: masterFieldApplicability(m.kind, 'exposure') },
    (v) => `${v}s`,
  );
}

/** Set-temperature applies to darks (masters have no Light column, matrix §Set temperature). */
function tempCell(m: CalibrationMaster): ReactNode {
  return renderValue(
    m.fingerprint?.tempC ?? null,
    { applicability: masterFieldApplicability(m.kind, 'setTemp') },
    (v) => `${v}°C`,
  );
}

/** Gain applies to every master kind. */
function gainCell(m: CalibrationMaster): ReactNode {
  return renderValue(m.fingerprint?.gain ?? null, {
    applicability: 'applicable',
  });
}

/** Binning applies to every master kind. */
function binningCell(m: CalibrationMaster): ReactNode {
  return renderValue(
    m.fingerprint?.binning ?? null,
    { applicability: 'applicable' },
    (v) => String(v).replace('x', '×'),
  );
}

/** Camera applies to every master kind. */
function cameraCell(m: CalibrationMaster): ReactNode {
  return renderValue(m.fingerprint?.camera ?? null, {
    applicability: 'applicable',
  });
}

/**
 * How many sessions / projects reference this master. Real usage figures from
 * `usedBySessionIds` / `usedByProjectIds`. Renders "3 sessions · 1 project",
 * collapsing to the non-zero parts, or "unused" when nothing references it.
 */
function usageSummary(master: CalibrationMaster): string {
  const sessions = (master.usedBySessionIds ?? []).length;
  const projects = (master.usedByProjectIds ?? []).length;
  const parts: string[] = [];
  if (sessions > 0)
    parts.push(m.calibration_usage_sessions({ count: sessions }));
  if (projects > 0)
    parts.push(m.calibration_usage_projects({ count: projects }));
  return parts.length > 0 ? parts.join(' · ') : 'unused';
}

function usageCount(m: CalibrationMaster): number {
  return (m.usedBySessionIds ?? []).length + (m.usedByProjectIds ?? []).length;
}

function createdDate(m: CalibrationMaster): string {
  return m.createdAt.split('T')[0];
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function compareStr(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareMasters(
  a: CalibrationMaster,
  b: CalibrationMaster,
  sort: MasterSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'master':
      cmp = compareStr(masterLabel(a), masterLabel(b));
      break;
    case 'camera':
      cmp = compareStr(a.fingerprint?.camera, b.fingerprint?.camera);
      break;
    case 'filter':
      cmp = compareStr(a.fingerprint?.filter, b.fingerprint?.filter);
      break;
    case 'gain':
      cmp =
        (a.fingerprint?.gain ?? -Infinity) - (b.fingerprint?.gain ?? -Infinity);
      break;
    case 'exposure':
      cmp =
        (a.fingerprint?.exposureS ?? -Infinity) -
        (b.fingerprint?.exposureS ?? -Infinity);
      break;
    case 'temp':
      cmp =
        (a.fingerprint?.tempC ?? -Infinity) -
        (b.fingerprint?.tempC ?? -Infinity);
      break;
    case 'binning':
      cmp = compareStr(a.fingerprint?.binning, b.fingerprint?.binning);
      break;
    case 'usage':
      cmp = usageCount(a) - usageCount(b);
      break;
    case 'created':
      cmp = compareStr(a.createdAt, b.createdAt);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Multi-level grouping accessors ────────────────────────────────────────────

export const MASTER_ACCESSORS: Readonly<
  Record<string, DimensionAccessor<CalibrationMaster>>
> = {
  kind: (m) => m.kind.toLowerCase(),
  camera: (m) => m.fingerprint?.camera,
  // #788: no separate instrument field on the fingerprint — "instrument" was
  // a byte-identical duplicate of "camera" and has been dropped as a Group-by
  // dimension (see CALIB_DIMENSIONS in CalibrationPage.tsx).
  // Filter is meaningful for flats (Ha/OIII/L/…); null for bias/dark.
  filter: (m) => m.fingerprint?.filter,
  // No source-night field on the master yet → group on the master's creation
  // date as a proxy (date part for Night, year-month for Month).
  night: (m) => m.createdAt?.slice(0, 10),
  month: (m) => m.createdAt?.slice(0, 7),
};

// ── Column model ──────────────────────────────────────────────────────────────

// `label` is a render-time thunk so headers re-read the active locale (spec 046 #8).
const COLUMNS: Array<{
  key: string;
  label: () => string;
  sort: MasterSortCol;
  className?: string;
}> = [
  { key: 'master', label: () => m.calibration_col_master(), sort: 'master' },
  {
    key: 'camera',
    label: () => m.settings_calmatch_camera(),
    sort: 'camera',
    className: 'alm-calib-cell--muted',
  },
  { key: 'filter', label: () => m.common_filter(), sort: 'filter' },
  {
    key: 'gain',
    label: () => m.settings_calmatch_gain(),
    sort: 'gain',
    className: 'alm-calib-cell--num',
  },
  {
    key: 'exposure',
    label: () => m.calibration_fp_exposure(),
    sort: 'exposure',
    className: 'alm-calib-cell--mono',
  },
  {
    key: 'temp',
    label: () => m.calibration_col_temp(),
    sort: 'temp',
    className: 'alm-calib-cell--mono',
  },
  {
    key: 'binning',
    label: () => m.settings_calmatch_binning(),
    sort: 'binning',
    className: 'alm-calib-cell--mono',
  },
  {
    key: 'usage',
    label: () => m.calibration_col_usage(),
    sort: 'usage',
    className: 'alm-calib-cell--muted',
  },
  {
    key: 'created',
    label: () => m.archive_prop_date(),
    sort: 'created',
    className: 'alm-calib-cell--mono',
  },
];

// ── Props ───────────────────────────────────────────────────────────────────────

interface Props {
  masters: CalibrationMaster[];
  loading: boolean;
  error: string | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  sort: MasterSort;
  onSort: (col: MasterSortCol) => void;
  /** Days threshold for the "aging" warning pill. Comes from persisted settings (FR-023). */
  agingThresholdDays: number;
  /**
   * Active ordered grouping dimension ids from `useGrouping`.
   * When empty the table renders a flat sorted list.
   */
  dims?: string[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MastersTable({
  masters,
  loading,
  error,
  selected,
  onSelect,
  sort,
  onSort,
  agingThresholdDays,
  dims = [],
}: Props) {
  const { collapsed, toggle } = useCollapsibleGroups();

  // FR-001: only dark/flat/bias masters are ever shown, flat or grouped.
  const shown = useMemo(
    () => masters.filter((mm) => shownKind(mm.kind) !== null),
    [masters],
  );

  const sorted = useMemo(
    () => [...shown].sort((a, b) => compareMasters(a, b, sort)),
    [shown, sort],
  );

  // Flat by default; multi-level grouping only when the user picks dimensions.
  const useMultiGroup = dims.length > 0;

  const tree = useMemo(
    () =>
      useMultiGroup ? groupByDimensions(sorted, dims, MASTER_ACCESSORS) : [],
    [sorted, dims, useMultiGroup],
  );

  const visualRows = useMemo(
    () => (useMultiGroup ? flattenVisibleGroups(tree, collapsed) : []),
    [tree, collapsed, useMultiGroup],
  );

  if (loading) {
    return (
      <div className="alm-calib-table__status">
        <Skeleton
          variant="block"
          count={6}
          data-testid="masters-loading"
          label={m.calibration_loading()}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="alm-calib-table__status">
        <EmptyState
          title={m.calibration_load_error_title()}
          desc={error}
          data-testid="masters-error"
        />
      </div>
    );
  }

  if (shown.length === 0) {
    return (
      <div className="alm-calib-table__status">
        <EmptyState
          title={m.calibration_empty_title()}
          desc={m.calibration_empty_desc()}
          data-testid="masters-empty"
        />
      </div>
    );
  }

  // Sortable header buttons (column header passthrough).
  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    ariaSort: ariaSortFor(sort.col === c.sort, sort.dir),
    label: (
      <SortHeader
        label={c.label()}
        active={sort.col === c.sort}
        dir={sort.dir}
        onClick={() => onSort(c.sort)}
        ariaLabel={m.calibration_sort_by_aria({ col: c.label() })}
      />
    ),
  }));

  const EMPTY_MASTER_CELLS = {
    camera: '' as string,
    filter: '' as string,
    gain: '' as string,
    exposure: '' as string,
    temp: '' as string,
    binning: '' as string,
    usage: '' as string,
    created: '' as string,
  };

  function masterItemRow(master: CalibrationMaster, indentPx = 0): TableRow {
    const isAging = master.ageDays > agingThresholdDays;
    const kindStr = master.kind.toLowerCase();
    return {
      _testid: `master-row-${master.id}`,
      _rowClassName:
        'alm-calib-table__row' +
        (selected === master.id ? ' alm-calib-table__row--selected' : ''),
      _onClick: () => onSelect(master.id),
      _selected: selected === master.id,
      _indent: indentPx || undefined,
      master: (
        <span className="alm-calib-cell__master">
          <Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
          <span className="alm-calib-cell__master-label">
            {masterLabel(master)}
          </span>
          {isAging && (
            <Pill variant="warn">
              {m.calibration_aging_days({ days: master.ageDays })}
            </Pill>
          )}
        </span>
      ),
      camera: cameraCell(master),
      filter: filterCell(master),
      gain: gainCell(master),
      exposure: exposureCell(master),
      temp: tempCell(master),
      binning: binningCell(master),
      usage: (
        <span data-testid={`master-usage-${master.id}`}>
          {usageSummary(master)}
        </span>
      ),
      created: createdDate(master),
    };
  }

  // Build rows: flat sorted list (default) or multi-level grouping.
  const rows: TableRow[] = [];

  if (useMultiGroup) {
    for (const vrow of visualRows) {
      if (vrow.kind === 'header') {
        const { node, depth, path, collapsed: isCollapsed } = vrow;
        rows.push({
          _rowClassName: 'alm-listgroup',
          _indent: tableIndent(depth),
          master: (
            <button
              type="button"
              className="alm-listgroup__cell"
              data-testid={`calibration-group-${node.dimension}-${node.key}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(path)}
            >
              <span className="alm-listgroup__caret" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span className="alm-listgroup__label">{node.label}</span>
              <span className="alm-listgroup__count">{node.count}</span>
            </button>
          ),
          ...EMPTY_MASTER_CELLS,
        });
      } else {
        rows.push(masterItemRow(vrow.item, tableIndent(vrow.depth)));
      }
    }
  } else {
    // Flat sorted list (default, dims empty).
    for (const master of sorted) {
      rows.push(masterItemRow(master));
    }
  }

  return <Table className="alm-calib-table" columns={columns} rows={rows} />;
}
