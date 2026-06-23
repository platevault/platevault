/**
 * MastersTable — spec 043 §4 Calibration redesign (shared-layout adoption, #73).
 *
 * Replaces the old narrow `MastersList` sidebar with a DENSE, FULL-WIDTH
 * sortable table — the same surface pattern as SessionsTable (shared `Table`
 * from `@/ui`). Masters are GROUPED BY KIND (dark / flat / bias): each kind is a
 * spanning header row, with its masters listed beneath. `dark_flat` and
 * `bad_pixel_map` are not shown in v1 (FR-001).
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

import { useMemo } from 'react';
import { Pill, Table, EmptyState } from '@/ui';
import type { PillVariant, TableColumn, TableRow } from '@/ui';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import { m } from '@/lib/i18n';

// ── Kind grouping model ────────────────────────────────────────────────────────

type Kind = 'dark' | 'flat' | 'bias';

const KIND_ORDER: Kind[] = ['dark', 'flat', 'bias'];
const GROUP_LABELS: Record<Kind, string> = {
  dark: 'DARKS',
  flat: 'FLATS',
  bias: 'BIAS',
};

function kindLabel(kind: string): Kind | null {
  if (kind === 'dark' || kind === 'flat' || kind === 'bias') return kind;
  return null;
}

function kindVariant(kind: string): PillVariant {
  const map: Record<string, PillVariant> = { dark: 'info', flat: 'accent', bias: 'neutral' };
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

/** What the table groups rows by. Kind is the default (and only) grouping in v1. */
export type MasterGroupBy = 'kind';
export const DEFAULT_MASTER_GROUP_BY: MasterGroupBy = 'kind';

const EMPTY = '—';

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
  return discriminator ? `Master ${kindCap} · ${discriminator}` : `Master ${kindCap}`;
}

/** Filter only applies to flats; other kinds render the empty marker. */
function filterCell(m: CalibrationMaster): string {
  if (m.kind.toLowerCase() !== 'flat') return EMPTY;
  return m.fingerprint?.filter ?? EMPTY;
}

/** Exposure only applies to darks; other kinds render the empty marker. */
function exposureCell(m: CalibrationMaster): string {
  if (m.kind.toLowerCase() !== 'dark') return EMPTY;
  return m.fingerprint?.exposureS != null ? `${m.fingerprint.exposureS}s` : EMPTY;
}

function tempCell(m: CalibrationMaster): string {
  return m.fingerprint?.tempC != null ? `${m.fingerprint.tempC}°C` : EMPTY;
}

function gainCell(m: CalibrationMaster): string {
  return m.fingerprint?.gain != null ? String(m.fingerprint.gain) : EMPTY;
}

function binningCell(m: CalibrationMaster): string {
  return m.fingerprint?.binning ? m.fingerprint.binning.replace('x', '×') : EMPTY;
}

function cameraCell(m: CalibrationMaster): string {
  return m.fingerprint?.camera ?? EMPTY;
}

/**
 * How many sessions / projects reference this master. Real usage figures from
 * `usedBySessionIds` / `usedByProjectIds`. Renders "3 sessions · 1 project",
 * collapsing to the non-zero parts, or "unused" when nothing references it.
 */
function usageSummary(m: CalibrationMaster): string {
  const sessions = (m.usedBySessionIds ?? []).length;
  const projects = (m.usedByProjectIds ?? []).length;
  const parts: string[] = [];
  if (sessions > 0) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
  if (projects > 0) parts.push(`${projects} project${projects === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'unused';
}

function usageCount(m: CalibrationMaster): number {
  return (m.usedBySessionIds ?? []).length + (m.usedByProjectIds ?? []).length;
}

function createdDate(m: CalibrationMaster): string {
  return m.createdAt.split('T')[0];
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareMasters(a: CalibrationMaster, b: CalibrationMaster, sort: MasterSort): number {
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
      cmp = (a.fingerprint?.gain ?? -Infinity) - (b.fingerprint?.gain ?? -Infinity);
      break;
    case 'exposure':
      cmp = (a.fingerprint?.exposureS ?? -Infinity) - (b.fingerprint?.exposureS ?? -Infinity);
      break;
    case 'temp':
      cmp = (a.fingerprint?.tempC ?? -Infinity) - (b.fingerprint?.tempC ?? -Infinity);
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

// ── Grouping ──────────────────────────────────────────────────────────────────

interface MasterGroup {
  kind: Kind;
  label: string;
  masters: CalibrationMaster[];
}

/** Group masters by kind (fixed order dark → flat → bias), sorting within each group. */
function groupMasters(masters: CalibrationMaster[], sort: MasterSort): MasterGroup[] {
  return KIND_ORDER.map((k) => ({
    kind: k,
    label: GROUP_LABELS[k],
    masters: masters
      .filter((m) => kindLabel(m.kind.toLowerCase()) === k)
      .sort((a, b) => compareMasters(a, b, sort)),
  })).filter((g) => g.masters.length > 0);
}

// ── Column model ──────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: string; label: string; sort: MasterSortCol; className?: string }> = [
  { key: 'master', label: m.calibration_col_master(), sort: 'master' },
  { key: 'camera', label: m.settings_calmatch_camera(), sort: 'camera', className: 'alm-calib-cell--muted' },
  { key: 'filter', label: m.common_filter(), sort: 'filter' },
  { key: 'gain', label: m.settings_calmatch_gain(), sort: 'gain', className: 'alm-calib-cell--num' },
  { key: 'exposure', label: m.calibration_fp_exposure(), sort: 'exposure', className: 'alm-calib-cell--mono' },
  { key: 'temp', label: m.calibration_col_temp(), sort: 'temp', className: 'alm-calib-cell--mono' },
  { key: 'binning', label: m.settings_calmatch_binning(), sort: 'binning', className: 'alm-calib-cell--mono' },
  { key: 'usage', label: m.calibration_col_usage(), sort: 'usage', className: 'alm-calib-cell--muted' },
  { key: 'created', label: m.archive_prop_date(), sort: 'created', className: 'alm-calib-cell--mono' },
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
}: Props) {
  const groups = useMemo(() => groupMasters(masters, sort), [masters, sort]);

  if (loading) {
    return (
      <div className="alm-calib-table__status" data-testid="masters-loading">
        {m.calibration_loading()}
      </div>
    );
  }

  if (error) {
    return (
      <div className="alm-calib-table__status">
        <EmptyState title={m.calibration_load_error_title()} desc={error} data-testid="masters-error" />
      </div>
    );
  }

  if (masters.length === 0) {
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
    label: (
      <button
        type="button"
        className={'alm-calib-sorth' + (sort.col === c.sort ? ' alm-calib-sorth--active' : '')}
        onClick={() => onSort(c.sort)}
        aria-label={m.calibration_sort_by_aria({ col: c.label })}
      >
        {c.label}
        {sort.col === c.sort && (
          <span className="alm-calib-sorth__arrow" aria-hidden="true">
            { }
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    ),
  }));

  // Flatten groups into rows: a spanning kind-header row, then master rows.
  const rows: TableRow[] = [];
  for (const group of groups) {
    rows.push({
      _rowClassName: 'alm-calib-table__group',
      master: (
        <span>
          {group.label}
          <span className="alm-calib-table__group-count">
            {group.masters.length} {group.masters.length === 1 ? m.calibration_master_singular() : m.status_masters_label()}
          </span>
        </span>
      ),
      camera: '',
      filter: '',
      gain: '',
      exposure: '',
      temp: '',
      binning: '',
      usage: '',
      created: '',
    });

    for (const master of group.masters) {
      const isAging = master.ageDays > agingThresholdDays;
      const kindStr = master.kind.toLowerCase();
      rows.push({
        _rowClassName:
          'alm-calib-table__row' + (selected === master.id ? ' alm-calib-table__row--selected' : ''),
        _onClick: () => onSelect(master.id),
        master: (
          <span className="alm-calib-cell__master">
            <Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
            <span className="alm-calib-cell__master-label">{masterLabel(master)}</span>
            {isAging && <Pill variant="warn">{m.calibration_aging_days({ days: master.ageDays })}</Pill>}
          </span>
        ),
        camera: cameraCell(master),
        filter: filterCell(master),
        gain: gainCell(master),
        exposure: exposureCell(master),
        temp: tempCell(master),
        binning: binningCell(master),
        usage: <span data-testid={`master-usage-${master.id}`}>{usageSummary(master)}</span>,
        created: createdDate(master),
      });
    }
  }

  return <Table className="alm-calib-table" columns={columns} rows={rows} />;
}
