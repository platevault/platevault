/**
 * PlanPanel — aggregate plan surface for the Inbox review screen.
 *
 * spec 041 (#1/#2 + US7 T041/T042): renders the bottom region of the inbox
 * centre column and shows EVERY open plan across all ingestions at once,
 * grouped by ingestion (one group per `InboxOpenPlan`). Each group has a
 * plan-level selection checkbox; the header has a select-all/none checkbox and
 * the apply controls. The destructive-destination control (default Archive)
 * now lives here (relocated out of the deleted ActionSidebar) and feeds the
 * confirm/apply data flow via the parent.
 *
 * Pure presentational component apart from local selection state — all data
 * fetching + mutations are owned by the parent (InboxPage).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Btn, Table } from '@/ui';
import type { InboxOpenPlan, InboxPlanAction } from './store';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Destructive-destination choice. The literal values are the strings the
 * backend `inbox.confirm` command accepts (`"archive"` keeps a recoverable
 * copy, `"trash"` uses the OS trash). Defaults to `"archive"` per
 * Constitution §II.
 */
export type DestructiveDestination = 'archive' | 'trash';

/**
 * One candidate destination root surfaced when a confirm fails with
 * `inbox.destination_root_required` (spec 041 US8/FR-029). Mirrors the
 * structured-error `details.candidates[]` shape emitted by the backend.
 */
export interface DestinationRootCandidate {
  rootId: string;
  path: string;
  kind: string;
}

/**
 * Pending destination-root selection: the user must pick one of `candidates`
 * before the plan for this item can be generated (FR-029). `category` is the
 * frame-type category the roots host (e.g. `light_frames`).
 */
export interface PendingRootPick {
  category: string;
  candidates: DestinationRootCandidate[];
}

export interface PlanPanelProps {
  /** Every open plan across all roots (already fetched by the parent). */
  plans: InboxOpenPlan[];
  /** Sum of actions across all plans, for the header count. */
  totalActions: number;
  destructiveDestination: DestructiveDestination;
  onDestructiveDestinationChange: (d: DestructiveDestination) => void;
  /** Apply only the currently-selected (checked) ingestion groups. */
  onApplySelected: (inboxItemIds: string[]) => void;
  /** Apply every open plan. */
  onApplyAll: () => void;
  /** Discard a single ingestion group's plan. */
  onCancel: (inboxItemId: string) => void;
  busy?: boolean;
  /**
   * Destination-root prompt (spec 041 US8/FR-029). Non-null when the last
   * confirm needs the user to choose among multiple candidate roots. The plan
   * cannot be generated/applied until a root is chosen.
   */
  pendingRootPick?: PendingRootPick | null;
  /** Re-invoke confirm with the chosen destination root. */
  onPickDestinationRoot?: (rootId: string) => void;
  /** Busy flag specific to the (re-)confirm triggered by a root pick. */
  rootPickBusy?: boolean;
  /**
   * Absolute destination paths keyed by source `fromPath`, populated from the
   * latest `inbox.confirm` response's `destinations[]` (spec 041 US8/FR-031).
   * Action rows show the absolute path when present, else the relative preview.
   */
  absoluteByFromPath?: Record<string, string>;
  /**
   * Frame-type hint per ingestion (`inboxItemId` → "bias" | "dark" | "flat" |
   * "light" | "master" | …), derived by the parent from the inbox item's
   * classification / breakdown (spec 043 #75). Used to label each collapsed
   * group bucket by frame type so catalogue actions (whose destination path
   * carries no frame keyword) aggregate to "N <frametype>" instead of
   * degenerating into one line per file.
   */
  frameTypeByItemId?: Record<string, string>;
  /**
   * Per-ingestion frame-type BREAKDOWN (`inboxItemId` → [{kind, count}, …]),
   * derived by the parent from the SAME data `InboxStatsSummary` computes from
   * the inbox item (the per-type bias/dark/flat/light/master tallies — see
   * `buildBreakdownByItemId` in InboxPage).
   *
   * spec 043 #75: this is the authoritative fix for the degenerate summary. The
   * plan ACTIONS carry no per-file frame type, and the single `frameTypeHint`
   * collapses a MIXED ingestion to one wrong label. When a breakdown is present
   * the collapsed summary renders ONE line listing every type with its count —
   * `"10 bias · 21 dark · 12 light → (root)"` — instead of per-file rows or a
   * single mislabelled type. Absent (no breakdown for the id) the panel falls
   * back to the per-action keyword/hint aggregation.
   */
  breakdownByItemId?: Record<string, ReadonlyArray<{ kind: string; count: number }>>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  move: 'Move',
  catalogue: 'Catalogue',
  archive: 'Archive',
  trash: 'Trash',
};

function actionLabel(kind: string): string {
  return ACTION_LABELS[kind] ?? kind;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Frame-type keywords we look for in a destination path to label a summary
 * line. `InboxPlanAction` carries no frame type, so we infer it from the path
 * the file is headed to (e.g. `masters/darks/…`, `IC1396/Ha/…` → no frame
 * keyword, falls back to the action kind). Keys are matched case-insensitively
 * against each path segment; the value is the singular label used for a count
 * of one (pluralised with a trailing "s").
 */
const FRAME_TYPE_KEYWORDS: Array<[token: string, singular: string]> = [
  ['lights', 'light'],
  ['light', 'light'],
  ['darkflats', 'dark flat'],
  ['dark_flats', 'dark flat'],
  ['darks', 'dark'],
  ['dark', 'dark'],
  ['flats', 'flat'],
  ['flat', 'flat'],
  ['biases', 'bias'],
  ['bias', 'bias'],
  ['masters', 'master'],
  ['master', 'master'],
];

/**
 * Normalise a raw frame-type hint (from the inbox item's classification /
 * breakdown — e.g. `groupFrameType` / `masterFrameType`) into the singular
 * label vocabulary used on the summary lines. Unknown values pass through
 * lower-cased so they still aggregate sensibly.
 */
function normalizeFrameTypeHint(raw: string): string {
  const v = raw.trim().toLowerCase();
  switch (v) {
    case 'lights':    return 'light';
    case 'darks':     return 'dark';
    case 'flats':     return 'flat';
    case 'biases':    return 'bias';
    case 'dark_flat':
    case 'darkflat':
    case 'dark_flats':
    case 'darkflats': return 'dark flat';
    case 'masters':   return 'master';
    default:          return v;
  }
}

/** Normalise a path's separators and split into lowercase segments. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/** Directory portion of a destination (drops the trailing file name). */
function destinationDir(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx > 0 ? norm.slice(0, idx) : norm;
}

/**
 * Shorten a long destination to a readable tail — keep the last two path
 * segments so the summary shows where files land without overflowing the row.
 */
function shortDestination(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 2) return norm;
  return `…/${parts.slice(-2).join('/')}`;
}

/**
 * Resolve the frame-type label for one action (spec 043 #75). Priority:
 *   1. a frame keyword present in the destination OR source path (handles split
 *      plans where each type lands in its own typed folder), then
 *   2. the per-ingestion hint from the inbox item's classification/breakdown
 *      (`itemFrameType` — e.g. a single-type catalogue folder of darks whose
 *      in-place destination carries no frame keyword), then
 *   3. the action kind (e.g. "catalogue") as a last resort.
 *
 * Putting the path keyword first lets a MIXED/split plan still distinguish
 * per-type buckets, while the item hint rescues single-type catalogue plans
 * from degenerating to one line per file.
 */
function frameTypeLabel(
  action: InboxPlanAction,
  destination: string,
  itemFrameType?: string,
): string {
  const segments = [...pathSegments(destination), ...pathSegments(action.fromPath)];
  for (const [token, singular] of FRAME_TYPE_KEYWORDS) {
    if (segments.includes(token)) return singular;
  }
  if (itemFrameType) return normalizeFrameTypeHint(itemFrameType);
  return actionLabel(action.action).toLowerCase();
}

/** Pluralise a singular frame/action label for a count. */
function pluralLabel(singular: string, count: number): string {
  if (count === 1) return singular;
  return singular.endsWith('s') ? singular : `${singular}s`;
}

/** One collapsed summary line: "N <frametype> → <destination tail>". */
export interface PlanGroupSummaryLine {
  /** Stable key for the row. */
  key: string;
  count: number;
  /** Singular frame/action label (e.g. "light", "dark", "catalogue"). */
  frameType: string;
  /** Shortened destination directory shown after the arrow. */
  destinationShort: string;
  /** Full destination directory for the title/tooltip. */
  destinationFull: string;
}

/**
 * Group a plan's actions by (frame type → destination directory) and produce
 * one summary line per bucket, sorted by frame type then destination. The
 * destination comes from the captured absolute path when present, else the
 * action's relative preview (mirrors the per-row fallback).
 */
function buildGroupSummary(
  actions: InboxPlanAction[],
  absoluteByFromPath?: Record<string, string>,
  itemFrameType?: string,
): PlanGroupSummaryLine[] {
  const buckets = new Map<
    string,
    { count: number; frameType: string; destinationFull: string }
  >();
  for (const a of actions) {
    const dest = absoluteByFromPath?.[a.fromPath] ?? a.destinationPreview;
    const frameType = frameTypeLabel(a, dest, itemFrameType);
    const destDir = destinationDir(dest);
    const key = `${frameType} ${destDir}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { count: 1, frameType, destinationFull: destDir });
  }
  return [...buckets.entries()]
    .sort(([ka], [kb]) => ka.localeCompare(kb))
    .map(([key, b]) => ({
      key,
      count: b.count,
      frameType: pluralLabel(b.frameType, b.count),
      destinationShort: shortDestination(b.destinationFull),
      destinationFull: b.destinationFull,
    }));
}

/**
 * Derive a per-type frame breakdown from a plan's ACTIONS, by classifying each
 * action with {@link frameTypeLabel} (frame keyword in the destination/source
 * path, then the per-ingestion `itemFrameType` hint). Returns `[{ kind, count }]`
 * buckets — the same shape the inbox item's classification breakdown carries —
 * so a MOVE/SPLIT plan whose files land in typed folders yields a true
 * multi-type tally (e.g. `light` + `dark`). A single-type catalogue ingestion
 * folds onto its hint; a mixed in-place catalogue (no keyword, no per-file
 * type) can only report the hint, which is the irreducible backend-data limit.
 *
 * InboxPage merges this with the selected item's real classification breakdown
 * (which DOES resolve a mixed catalogue) when building `breakdownByItemId`.
 */
export function buildBreakdownFromActions(
  actions: InboxPlanAction[],
  itemFrameType?: string,
  absoluteByFromPath?: Record<string, string>,
): Array<{ kind: string; count: number }> {
  const buckets = new Map<string, number>();
  for (const a of actions) {
    const dest = absoluteByFromPath?.[a.fromPath] ?? a.destinationPreview;
    const frameType = frameTypeLabel(a, dest, itemFrameType);
    buckets.set(frameType, (buckets.get(frameType) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([kind, count]) => ({ kind, count }));
}

/** One aggregated frame-type entry for the per-type breakdown summary line. */
export interface PlanGroupBreakdownEntry {
  /** Stable key for the entry. */
  key: string;
  count: number;
  /** Singular frame-type label (e.g. "bias", "dark", "light", "master"). */
  frameType: string;
}

/**
 * Build the per-type breakdown for one group from the ingestion's frame-type
 * tally (the SAME shape `InboxStatsSummary` derives from the inbox item — see
 * `buildBreakdownByItemId` in InboxPage). Each `{ kind, count }` becomes one
 * aggregated entry, normalised to the singular label vocabulary and merged so a
 * folder reporting e.g. both `lights` and `light` collapses to one bucket.
 * Sorted by frame type for a stable, readable order. Returns `[]` when there is
 * no usable breakdown, signalling the caller to fall back to the per-action
 * keyword/hint summary.
 */
function buildGroupBreakdown(
  breakdown: ReadonlyArray<{ kind: string; count: number }> | undefined,
): PlanGroupBreakdownEntry[] {
  if (!breakdown || breakdown.length === 0) return [];
  const buckets = new Map<string, number>();
  for (const { kind, count } of breakdown) {
    if (!kind || count <= 0) continue;
    const frameType = normalizeFrameTypeHint(kind);
    buckets.set(frameType, (buckets.get(frameType) ?? 0) + count);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([frameType, count]) => ({ key: frameType, count, frameType }));
}

/**
 * Resolve the single destination shown after the breakdown summary's arrow.
 * For an in-place catalogue ingestion this is the ingestion folder (`(root)`
 * when empty); otherwise the common destination directory tail of the actions.
 */
function breakdownDestination(
  actions: InboxPlanAction[],
  itemName: string,
  absoluteByFromPath?: Record<string, string>,
): { short: string; full: string } {
  const dirs = new Set<string>();
  for (const a of actions) {
    const dest = absoluteByFromPath?.[a.fromPath] ?? a.destinationPreview;
    dirs.add(destinationDir(dest));
  }
  if (dirs.size === 1) {
    const full = [...dirs][0] || itemName || '(root)';
    return { short: shortDestination(full), full };
  }
  // Files land in several typed folders — name the ingestion instead.
  const full = itemName || '(root)';
  return { short: full, full };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlanPanel({
  plans,
  totalActions,
  destructiveDestination,
  onDestructiveDestinationChange,
  onApplySelected,
  onApplyAll,
  onCancel,
  busy = false,
  pendingRootPick = null,
  onPickDestinationRoot,
  rootPickBusy = false,
  absoluteByFromPath,
  frameTypeByItemId,
  breakdownByItemId,
}: PlanPanelProps) {
  // Plan-level selection set, keyed by inboxItemId. Stale plans cannot be
  // selected (and are pruned from the set if they become stale).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Per-group file-row visibility, keyed by inboxItemId. Groups are COLLAPSED
  // by default — only the summary lines show until a group is expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((inboxItemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(inboxItemId)) next.delete(inboxItemId);
      else next.add(inboxItemId);
      return next;
    });
  }, []);

  // Selectable = not stale. Keep the selection set in sync as the open-plans
  // list changes (e.g. after an apply removes a plan, or a plan goes stale).
  const selectableIds = useMemo(
    () => plans.filter((p) => !p.stale).map((p) => p.inboxItemId),
    [plans],
  );

  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(selectableIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectableIds]);

  const hasDestructive = useMemo(
    () => plans.some((p) => p.actions.some((a) => a.requiresDestructiveConfirm)),
    [plans],
  );

  const selectedArray = useMemo(() => [...selected], [selected]);
  const anySelectedStale = false; // selection set never contains stale plans by construction
  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleGroup = (inboxItemId: string, stale: boolean) => {
    if (stale) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(inboxItemId)) next.delete(inboxItemId);
      else next.add(inboxItemId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === selectableIds.length && selectableIds.length > 0
        ? new Set()
        : new Set(selectableIds),
    );
  };

  // Starting global action index per plan, so each absolute-path cell gets a
  // stable, unique `inbox-dest-absolute-<idx>` testid (computed during render
  // instead of mutating a counter, which the immutability lint forbids).
  const planRowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const p of plans) {
      offsets.push(running);
      running += p.actions.length;
    }
    return offsets;
  }, [plans]);

  // ── Destination-root picker (spec 041 US8/FR-029) ──
  // Surfaced whenever the last confirm needs a root choice. Block apply until
  // chosen: the plan isn't generated until confirm succeeds with a rootId.
  const rootPicker = pendingRootPick ? (
    <div
      className="alm-plan-panel__root-picker"
      data-testid="inbox-root-picker"
    >
      <div className="alm-plan-panel__root-picker-title">
        Choose a destination library root
      </div>
      <div className="alm-plan-panel__root-picker-desc">
        More than one library root can host <strong>{pendingRootPick.category}</strong> frames.
        Pick where these files should go to generate the plan.
      </div>
      <div className="alm-plan-panel__root-picker-options">
        {pendingRootPick.candidates.map((c) => (
          <Btn
            key={c.rootId}
            variant="ghost"
            onClick={() => onPickDestinationRoot?.(c.rootId)}
            disabled={rootPickBusy}
            data-testid={`inbox-root-option-${c.rootId}`}
            aria-label={`Use ${c.path} as destination root`}
            className="alm-plan-panel__root-option"
          >
            <span className="alm-plan-panel__root-option-inner">
              <code className="alm-plan-panel__root-option-path">{c.path}</code>
              <span className="alm-plan-panel__root-option-kind">
                {c.kind}
              </span>
            </span>
          </Btn>
        ))}
      </div>
    </div>
  ) : null;

  // ── Empty state ──
  // Nothing to show unless there is at least one open plan OR a pending root
  // pick (the latter can occur with zero open plans — the plan wasn't created).
  if (plans.length === 0) {
    return rootPicker ? (
      <div className="alm-plan-panel" data-testid="plan-panel">
        {rootPicker}
      </div>
    ) : null;
  }

  const applySelectedDisabled =
    busy || selectedArray.length === 0 || anySelectedStale;
  const applyAllDisabled = busy || plans.length === 0;

  return (
    <div className="alm-plan-panel" data-testid="plan-panel">
      {/* ── Destination-root picker (FR-029): blocks apply until chosen ── */}
      {rootPicker}

      {/* ── Pinned header: counts + select-all + apply controls ── */}
      <div className="alm-plan-panel__bar" data-testid="plan-panel-bar">
        <div className="alm-plan-panel__bar-left">
          <label
            className="alm-plan-panel__select-all"
          >
            <input
              type="checkbox"
              checked={allSelectableSelected}
              onChange={toggleAll}
              disabled={selectableIds.length === 0}
              aria-label="Select all plans"
              data-testid="plan-select-all"
            />
            <span className="alm-plan-panel__select-all-label">Select all</span>
          </label>
          <span
            className="alm-plan-panel__count-summary"
            data-testid="plan-total-count"
          >
            {plans.length} plan{plans.length !== 1 ? 's' : ''} · {totalActions} action
            {totalActions !== 1 ? 's' : ''}
          </span>
        </div>
        <div
          className="alm-plan-panel__bar-actions"
        >
          <Btn
            variant="primary"
            onClick={() => onApplySelected(selectedArray)}
            disabled={applySelectedDisabled}
            data-testid="plan-apply-selected"
            aria-label="Apply selected plans"
          >
            {busy ? 'Applying…' : `Apply selected (${selectedArray.length})`}
          </Btn>
          <Btn
            variant="accent"
            onClick={onApplyAll}
            disabled={applyAllDisabled}
            data-testid="plan-apply-all"
            aria-label="Apply all plans"
          >
            Apply all
          </Btn>
        </div>
      </div>

      {/* ── Scrollable group list ── */}
      <div className="alm-plan-panel__scroll" data-testid="plan-panel-scroll">
        {plans.map((plan, planIdx) => {
          const checked = selected.has(plan.inboxItemId);
          const isExpanded = expanded.has(plan.inboxItemId);
          // Collapsed-by-default summary. PREFERRED: the ingestion's frame-type
          // BREAKDOWN (the per-type bias/dark/flat/light/master tally derived
          // from the inbox item) → ONE line "10 bias · 21 dark · 12 light →
          // <dest>". This is the #75 fix — plan actions carry no per-file frame
          // type and a single hint mislabels a MIXED folder. FALLBACK (no
          // breakdown): one line per (frame type → destination) inferred from
          // each action's path keyword + the per-ingestion hint.
          const breakdownEntries = buildGroupBreakdown(
            breakdownByItemId?.[plan.inboxItemId],
          );
          const summaryLines =
            breakdownEntries.length > 0
              ? []
              : buildGroupSummary(
                  plan.actions,
                  absoluteByFromPath,
                  frameTypeByItemId?.[plan.inboxItemId],
                );
          const breakdownDest =
            breakdownEntries.length > 0
              ? breakdownDestination(plan.actions, plan.itemName, absoluteByFromPath)
              : null;
          const rowsId = `plan-group-rows-${plan.inboxItemId}`;
          return (
            <section
              key={plan.inboxItemId}
              className="alm-plan-panel__group"
              data-testid={`plan-group-${plan.inboxItemId}`}
            >
              {/* Group header */}
              <div
                className="alm-plan-panel__group-header"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={plan.stale}
                  onChange={() => toggleGroup(plan.inboxItemId, plan.stale)}
                  aria-label={`Select plan for ${plan.itemName}`}
                  data-testid={`plan-group-check-${plan.inboxItemId}`}
                />
                {/* Expand/collapse the per-file rows (collapsed by default). */}
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpanded(plan.inboxItemId)}
                  aria-expanded={isExpanded}
                  aria-controls={rowsId}
                  aria-label={
                    isExpanded
                      ? `Hide files for ${plan.itemName}`
                      : `Show files for ${plan.itemName}`
                  }
                  data-testid={`plan-group-toggle-${plan.inboxItemId}`}
                  className="alm-plan-panel__expand"
                >
                  <span
                    className={
                      isExpanded
                        ? 'alm-plan-panel__chevron alm-plan-panel__chevron--open'
                        : 'alm-plan-panel__chevron'
                    }
                    aria-hidden="true"
                  >
                    ▸
                  </span>
                </Btn>
                <span
                  className="alm-plan-panel__group-name"
                  title={plan.itemName}
                >
                  {plan.itemName}
                </span>
                {/* Inline breakdown summary on the same row as the group header:
                    "10 bias · 21 dark · 12 light → <dest>". */}
                <ul
                  className="alm-plan-panel__summary alm-plan-panel__summary--inline"
                  data-testid={`plan-group-summary-${plan.inboxItemId}`}
                >
                  {breakdownEntries.length > 0 && breakdownDest ? (
                    <li className="alm-plan-panel__summary-line">
                      <span className="alm-plan-panel__summary-breakdown">
                        {breakdownEntries.map((entry, i) => (
                          <span key={entry.key} className="alm-plan-panel__summary-type">
                            {i > 0 && (
                              <span className="alm-plan-panel__summary-sep" aria-hidden="true">
                                ·{' '}
                              </span>
                            )}
                            <span className="alm-plan-panel__summary-type-count">
                              {entry.count}
                            </span>{' '}
                            <span className="alm-plan-panel__summary-type-name">
                              {pluralLabel(entry.frameType, entry.count)}
                            </span>
                          </span>
                        ))}
                      </span>
                      <span className="alm-plan-panel__summary-arrow" aria-hidden="true">
                        →
                      </span>
                      <code
                        className="alm-plan-panel__summary-dest"
                        title={breakdownDest.full}
                      >
                        {breakdownDest.short}
                      </code>
                    </li>
                  ) : (
                    summaryLines.map((line) => (
                      <li key={line.key} className="alm-plan-panel__summary-line">
                        <span className="alm-plan-panel__summary-count">
                          {line.count} {pluralLabel(line.frameType, line.count)}
                        </span>
                        <span className="alm-plan-panel__summary-arrow" aria-hidden="true">
                          →
                        </span>
                        <code
                          className="alm-plan-panel__summary-dest"
                          title={line.destinationFull}
                        >
                          {line.destinationShort}
                        </code>
                      </li>
                    ))
                  )}
                </ul>
                {plan.stale && (
                  <span
                    className="alm-plan-panel__stale-badge"
                    data-testid={`plan-stale-${plan.inboxItemId}`}
                  >
                    Stale
                  </span>
                )}
                <Btn
                  variant="ghost"
                  onClick={() => onCancel(plan.inboxItemId)}
                  disabled={busy}
                  data-testid={`plan-cancel-${plan.inboxItemId}`}
                  aria-label={`Discard plan for ${plan.itemName}`}
                >
                  Discard
                </Btn>
              </div>

              {plan.stale && (
                <Banner variant="danger" className="alm-plan-panel__stale-banner">
                  Source files changed — discard and re-confirm to regenerate this plan.
                </Banner>
              )}

              {/* Per-file action detail — standard Table, hidden until the
                  group is expanded. Columns: Action · File · Destination. */}
              {isExpanded && (
                <div className="alm-plan-panel__rows" id={rowsId}>
                  <Table
                    className="alm-plan-panel__table"
                    columns={[
                      { key: 'action', label: 'Action', style: { width: 96 } },
                      { key: 'file', label: 'File', style: { width: 220 } },
                      { key: 'dest', label: 'Destination' },
                    ]}
                    rows={plan.actions.map((a, actionPos) => {
                      const rowIdx = planRowOffsets[planIdx] + actionPos;
                      // FR-031: prefer the absolute destination path from the last
                      // confirm response (keyed by source path); fall back to the
                      // root-relative preview for plans without a captured absolute.
                      const absolute = absoluteByFromPath?.[a.fromPath];
                      const destText = absolute ?? a.destinationPreview;
                      return {
                        action: (
                          <span className="alm-plan-panel__kind">
                            {actionLabel(a.action)}
                          </span>
                        ),
                        file: (
                          <span
                            className="alm-plan-panel__filename"
                            title={a.fromPath}
                          >
                            {basename(a.fromPath)}
                          </span>
                        ),
                        dest: (
                          <code
                            className="alm-plan-panel__dest"
                            data-testid={`inbox-dest-absolute-${rowIdx}`}
                            title={destText}
                          >
                            {destText}
                          </code>
                        ),
                      };
                    })}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Destructive destination control (relocated from ActionSidebar) ── */}
      {hasDestructive && (
        <div
          className="alm-plan-panel__destructive"
        >
          <div className="alm-plan-panel__destructive-title">
            Where should removed source files go?
          </div>
          <div
            className="alm-plan-panel__dest-options"
          >
            <label className="alm-plan-panel__dest-label">
              <input
                type="radio"
                name="destructive-destination"
                value="archive"
                checked={destructiveDestination === 'archive'}
                onChange={() => onDestructiveDestinationChange('archive')}
                data-testid="plan-destructive-archive"
              />
              <span>
                <strong>Archive folder</strong>
                <span className="alm-plan-panel__dest-label-hint">
                  Archive keeps a recoverable copy; Trash is unrecoverable.
                </span>
              </span>
            </label>
            <label className="alm-plan-panel__dest-label">
              <input
                type="radio"
                name="destructive-destination"
                value="trash"
                checked={destructiveDestination === 'trash'}
                onChange={() => onDestructiveDestinationChange('trash')}
                data-testid="plan-destructive-trash"
              />
              <span>System Trash</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
