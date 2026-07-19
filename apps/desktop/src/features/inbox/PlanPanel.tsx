// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
import { Banner, Btn } from '@/ui';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { errMessage } from '@/lib/errors';
import type { PlanApplyProgress } from '@/features/plans/usePlanApplyProgress';
import type { InboxOpenPlan, InboxPlanAction } from './store';
import { m } from '@/lib/i18n';

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
  /**
   * Apply a single ingestion group's plan with live per-item progress
   * streamed over the long-operation `OperationEvent` channel (spec 042
   * US16 / FR-021). Receives the group's `planId`.
   */
  onApplyOne?: (planId: string) => void;
  /**
   * Live progress for the plan currently streaming (the one whose `planId`
   * matches `progressPlanId`). Null when no live apply is in flight.
   */
  progress?: PlanApplyProgress | null;
  /** `planId` of the group whose live `progress` is being shown. */
  progressPlanId?: string | null;
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
  breakdownByItemId?: Record<
    string,
    ReadonlyArray<{ kind: string; count: number }>
  >;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function actionLabel(kind: string): string {
  switch (kind) {
    case 'move':
      return m.inbox_action_move();
    case 'catalogue':
      return m.inbox_action_catalogue();
    case 'archive':
      return m.inbox_action_archive();
    case 'trash':
      return m.inbox_action_trash();
    default:
      return kind;
  }
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
    case 'lights':
      return 'light';
    case 'darks':
      return 'dark';
    case 'flats':
      return 'flat';
    case 'biases':
      return 'bias';
    case 'dark_flat':
    case 'darkflat':
    case 'dark_flats':
    case 'darkflats':
      return 'dark flat';
    case 'masters':
      return 'master';
    default:
      return v;
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
  const segments = [
    ...pathSegments(destination),
    ...pathSegments(action.fromPath),
  ];
  for (const [token, singular] of FRAME_TYPE_KEYWORDS) {
    if (segments.includes(token)) return singular;
  }
  // Match a frame keyword INSIDE the file name (e.g. "bias_001.fits",
  // "master_dark_300s.fits") so per-file rows of an in-place mixed folder get
  // their real type instead of the folder's dominant hint.
  const base = basename(action.fromPath).toLowerCase();
  for (const [token, singular] of FRAME_TYPE_KEYWORDS) {
    if (base.includes(token)) return singular;
  }
  if (itemFrameType) return normalizeFrameTypeHint(itemFrameType);
  return actionLabel(action.action).toLowerCase();
}

/** Pluralise a singular frame/action label for a count. */
function pluralLabel(singular: string, count: number): string {
  if (count === 1) return singular;
  return singular.endsWith('s') ? singular : `${singular}s`;
}

/**
 * Localized "{count} <frame type>" count-variant thunks for the KNOWN canonical
 * frame-type bucket keys (see `FRAME_TYPE_KEYWORDS`/`normalizeFrameTypeHint`:
 * light/dark/flat/bias/dark flat/master). Render-time thunks (spec 046 #8) so
 * they re-read the active locale on each call rather than resolving once at
 * module scope.
 */
const FRAMETYPE_COUNT_LABEL_FNS: Record<string, (count: number) => string> = {
  light: (count) => m.inbox_frametype_count_light({ count }),
  dark: (count) => m.inbox_frametype_count_dark({ count }),
  flat: (count) => m.inbox_frametype_count_flat({ count }),
  bias: (count) => m.inbox_frametype_count_bias({ count }),
  'dark flat': (count) => m.inbox_frametype_count_dark_flat({ count }),
  master: (count) => m.inbox_frametype_count_master({ count }),
};

/**
 * Localized "{count} <frame type>" label for a plan summary bucket. Returns
 * the count-variant message for a KNOWN canonical frame-type key; returns
 * `null` for unknown values (e.g. the `actionLabel(...).toLowerCase()`
 * fallback for an unrecognised frame type) so the caller falls back to the
 * existing `pluralLabel` behaviour, which is already localized at its source.
 */
function frameTypeCountLabel(frameType: string, count: number): string | null {
  return FRAMETYPE_COUNT_LABEL_FNS[frameType]?.(count) ?? null;
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
    const key = `${frameType}${destDir}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { count: 1, frameType, destinationFull: destDir });
  }
  return [...buckets.entries()]
    .sort(([ka], [kb]) => ka.localeCompare(kb))
    .map(([key, b]) => ({
      key,
      count: b.count,
      // Kept SINGULAR (not pluralised here) so the JSX consumer can key off
      // the canonical value to pick a localized count-variant message for a
      // known frame type, falling back to `pluralLabel` for unknown ones.
      frameType: b.frameType,
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
  onApplyOne,
  progress = null,
  progressPlanId = null,
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
    () =>
      plans.some((p) => p.actions.some((a) => a.requiresDestructiveConfirm)),
    [plans],
  );

  // Destructive-confirm gate (FR-003, D9, issue #741): `destructive_confirmed`
  // had no writer anywhere, so every plan with a trash/delete item was
  // permanently refused at apply time. Plan-level (not per-item —
  // `InboxPlanAction` carries no item id), matching the destructive-destination
  // control above. Tracked by plan id rather than a single boolean so newly
  // arrived destructive plans are not mistaken for already-confirmed ones.
  const [confirmedPlanIds, setConfirmedPlanIds] = useState<Set<string>>(
    new Set(),
  );
  const [confirmingDestructive, setConfirmingDestructive] = useState(false);
  const [confirmDestructiveError, setConfirmDestructiveError] = useState<
    string | null
  >(null);

  const destructivePlanIds = useMemo(
    () =>
      plans
        .filter((p) => p.actions.some((a) => a.requiresDestructiveConfirm))
        .map((p) => p.planId),
    [plans],
  );
  const allDestructiveConfirmed = destructivePlanIds.every((id) =>
    confirmedPlanIds.has(id),
  );

  const handleConfirmDestructive = useCallback(async () => {
    if (confirmingDestructive) return;
    const pending = destructivePlanIds.filter(
      (id) => !confirmedPlanIds.has(id),
    );
    if (pending.length === 0) return;
    setConfirmingDestructive(true);
    setConfirmDestructiveError(null);
    try {
      await Promise.all(
        pending.map(async (id) =>
          unwrap(await commands.plansConfirmDestructive(id)),
        ),
      );
      setConfirmedPlanIds((prev) => new Set([...prev, ...pending]));
    } catch (e) {
      setConfirmDestructiveError(errMessage(e));
    } finally {
      setConfirmingDestructive(false);
    }
  }, [confirmingDestructive, destructivePlanIds, confirmedPlanIds]);

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
    <div className="pv-plan-panel__root-picker" data-testid="inbox-root-picker">
      <div className="pv-plan-panel__root-picker-title">
        {m.inbox_choose_dest_root_title()}
      </div>
      <div className="pv-plan-panel__root-picker-desc">
        {m.inbox_choose_dest_root_body({ category: pendingRootPick.category })}
      </div>
      <div className="pv-plan-panel__root-picker-options">
        {pendingRootPick.candidates.map((c) => (
          <Btn
            key={c.rootId}
            variant="ghost"
            onClick={() => onPickDestinationRoot?.(c.rootId)}
            disabled={rootPickBusy}
            data-testid={`inbox-root-option-${c.rootId}`}
            aria-label={m.inbox_use_as_destination_root_aria({ path: c.path })}
            className="pv-plan-panel__root-option"
          >
            <span className="pv-plan-panel__root-option-inner">
              <code className="pv-plan-panel__root-option-path">{c.path}</code>
              <span className="pv-plan-panel__root-option-kind">{c.kind}</span>
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
      <div className="pv-plan-panel" data-testid="plan-panel">
        {rootPicker}
      </div>
    ) : null;
  }

  const applySelectedDisabled =
    busy ||
    selectedArray.length === 0 ||
    anySelectedStale ||
    !allDestructiveConfirmed;
  const applyAllDisabled =
    busy || plans.length === 0 || !allDestructiveConfirmed;

  return (
    <div className="pv-plan-panel" data-testid="plan-panel">
      {/* ── Destination-root picker (FR-029): blocks apply until chosen ── */}
      {rootPicker}

      {/* ── Pinned header: counts + select-all + apply controls ── */}
      <div className="pv-plan-panel__bar" data-testid="plan-panel-bar">
        <div className="pv-plan-panel__bar-left">
          {}
          <label className="pv-plan-panel__select-all">
            <input
              type="checkbox"
              checked={allSelectableSelected}
              onChange={toggleAll}
              disabled={selectableIds.length === 0}
              aria-label={m.inbox_select_all_plans_aria()}
              data-testid="plan-select-all"
            />
            <span className="pv-plan-panel__select-all-label">
              {m.common_select_all()}
            </span>
          </label>
          <span
            className="pv-plan-panel__count-summary"
            data-testid="plan-total-count"
          >
            {m.plan_count_label({ count: plans.length })} ·{' '}
            {m.action_count_label({ count: totalActions })}
          </span>
        </div>
        <div className="pv-plan-panel__bar-actions">
          <Btn
            variant="primary"
            onClick={() => onApplySelected(selectedArray)}
            disabled={applySelectedDisabled}
            data-testid="plan-apply-selected"
            aria-label={m.inbox_apply_selected_plans_aria()}
          >
            {busy
              ? m.common_applying()
              : m.inbox_apply_selected_plans({ count: selectedArray.length })}
          </Btn>
          <Btn
            variant="ghost"
            onClick={onApplyAll}
            disabled={applyAllDisabled}
            data-testid="plan-apply-all"
            aria-label={m.inbox_apply_all_plans_aria()}
          >
            {m.inbox_apply_all()}
          </Btn>
        </div>
      </div>

      {/* ── Scrollable group list ── */}
      <div className="pv-plan-panel__scroll" data-testid="plan-panel-scroll">
        {/* Column header — aligns with each plan's group-header grid. */}
        <div className="pv-plan-panel__list-head" aria-hidden="true">
          <span className="pv-plan-panel__group-lead" />
          <span>{m.inbox_plan_col_plan()}</span>
          <span>{m.inbox_plan_col_composition()}</span>
          <span>{m.inbox_col_destination()}</span>
          <span>{m.inbox_col_files()}</span>
          <span />
        </div>
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
              ? breakdownDestination(
                  plan.actions,
                  plan.itemName,
                  absoluteByFromPath,
                )
              : null;
          // A plan is "catalogued in place" when no file moves — every action is a
          // catalogue (destination equals source). We surface that explicitly
          // instead of an arrow-to-folder, which reads as a move.
          const allInPlace =
            plan.actions.length > 0 &&
            plan.actions.every((a) => a.action === 'catalogue');
          // Count of files that actually move (for the at-a-glance plan summary).
          const moveCount = plan.actions.filter(
            (a) => a.action === 'move',
          ).length;
          const rowsId = `plan-group-rows-${plan.inboxItemId}`;
          return (
            <section
              key={plan.inboxItemId}
              className="pv-plan-panel__group"
              data-testid={`plan-group-${plan.inboxItemId}`}
            >
              {/* Group header — an aligned grid row (shares its column template
                  with the list head so every plan's columns line up). */}
              <div className="pv-plan-panel__group-header">
                {/* Col 1: select + expand */}
                <span className="pv-plan-panel__group-lead">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={plan.stale}
                    onChange={() => toggleGroup(plan.inboxItemId, plan.stale)}
                    aria-label={m.inbox_select_plan_aria({
                      name: plan.itemName,
                    })}
                    data-testid={`plan-group-check-${plan.inboxItemId}`}
                  />
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(plan.inboxItemId)}
                    aria-expanded={isExpanded}
                    aria-controls={rowsId}
                    aria-label={
                      isExpanded
                        ? m.inbox_hide_files_aria({ name: plan.itemName })
                        : m.inbox_show_files_aria({ name: plan.itemName })
                    }
                    data-testid={`plan-group-toggle-${plan.inboxItemId}`}
                    className="pv-plan-panel__expand"
                  >
                    <span
                      className={
                        isExpanded
                          ? 'pv-plan-panel__chevron pv-plan-panel__chevron--open'
                          : 'pv-plan-panel__chevron'
                      }
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                  </Btn>
                </span>

                {/* Col 2: plan / source folder ("(root)" for the library root) */}
                <span
                  className="pv-plan-panel__group-name"
                  title={plan.itemName || m.inbox_list_root_label()}
                >
                  {plan.itemName || m.inbox_list_root_label()}
                </span>

                {/* Col 3: composition breakdown (aligned). */}
                <span
                  className="pv-plan-panel__group-breakdown"
                  data-testid={`plan-group-summary-${plan.inboxItemId}`}
                >
                  {(breakdownEntries.length > 0
                    ? breakdownEntries
                    : summaryLines.map((l) => ({
                        key: l.key,
                        frameType: l.frameType,
                        count: l.count,
                      }))
                  ).map((entry, i) => {
                    // A KNOWN canonical frame type (light/dark/flat/bias/dark
                    // flat/master) gets a localized count-variant message that
                    // already embeds the number — render it as one node. An
                    // UNKNOWN frame type (e.g. the `actionLabel(...)` fallback)
                    // keeps the existing count + `pluralLabel` rendering.
                    const knownLabel = frameTypeCountLabel(
                      entry.frameType,
                      entry.count,
                    );
                    return (
                      <span
                        key={entry.key}
                        className="pv-plan-panel__summary-type"
                      >
                        {i > 0 && (
                          <span
                            className="pv-plan-panel__summary-sep"
                            aria-hidden="true"
                          >
                            ·{' '}
                          </span>
                        )}
                        {knownLabel !== null ? (
                          <span className="pv-plan-panel__summary-type-name">
                            {knownLabel}
                          </span>
                        ) : (
                          <>
                            <span className="pv-plan-panel__summary-type-count">
                              {entry.count}
                            </span>{' '}
                            <span className="pv-plan-panel__summary-type-name">
                              {pluralLabel(entry.frameType, entry.count)}
                            </span>
                          </>
                        )}
                      </span>
                    );
                  })}
                </span>

                {/* Col 4: destination (aligned across all plans). In-place
                    catalogues read "In place · <folder>"; moves read "→ <dest>". */}
                <span className="pv-plan-panel__group-dest">
                  {allInPlace ? (
                    <>
                      <span className="pv-plan-panel__inplace">
                        {m.inbox_inplace_label()}
                      </span>
                      <code
                        className="pv-plan-panel__summary-dest"
                        title={breakdownDest?.full ?? plan.itemName}
                      >
                        {breakdownDest?.short ?? plan.itemName}
                      </code>
                    </>
                  ) : (
                    <>
                      <span
                        className="pv-plan-panel__summary-arrow"
                        aria-hidden="true"
                      >
                        →
                      </span>
                      <code
                        className="pv-plan-panel__summary-dest"
                        title={
                          breakdownDest?.full ??
                          summaryLines[0]?.destinationFull ??
                          ''
                        }
                      >
                        {breakdownDest?.short ??
                          summaryLines[0]?.destinationShort ??
                          '—'}
                      </code>
                    </>
                  )}
                </span>

                {/* Col 5: file count (+ move/in-place split in the tooltip). */}
                <span
                  className="pv-plan-panel__group-count"
                  title={
                    moveCount > 0
                      ? m.inbox_plan_file_count_tooltip_mixed({
                          moved: moveCount,
                          inPlace: plan.actions.length - moveCount,
                        })
                      : m.inbox_plan_file_count_tooltip_inplace({
                          count: plan.actions.length,
                        })
                  }
                >
                  {m.inbox_list_file_count({ count: plan.actions.length })}
                </span>

                {/* Col 6: stale badge + per-group apply (live progress) + discard */}
                <span className="pv-plan-panel__group-actions">
                  {plan.stale && (
                    <span
                      className="pv-plan-panel__stale-badge"
                      data-testid={`plan-stale-${plan.inboxItemId}`}
                    >
                      {m.inbox_stale()}
                    </span>
                  )}
                  {/* Apply just this ingestion's plan with live per-item
                      progress streamed over the OperationEvent channel
                      (spec 042 US16 / FR-021). */}
                  {onApplyOne && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => onApplyOne(plan.planId)}
                      disabled={
                        busy ||
                        plan.stale ||
                        (plan.actions.some(
                          (a) => a.requiresDestructiveConfirm,
                        ) &&
                          !confirmedPlanIds.has(plan.planId))
                      }
                      data-testid={`plan-apply-one-${plan.inboxItemId}`}
                      aria-label={m.inbox_apply_plan_live_aria({
                        name: plan.itemName,
                      })}
                    >
                      {m.inbox_apply_action()}
                    </Btn>
                  )}
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(plan.inboxItemId)}
                    disabled={busy}
                    data-testid={`plan-cancel-${plan.inboxItemId}`}
                    aria-label={m.inbox_discard_plan_aria({
                      name: plan.itemName,
                    })}
                  >
                    {m.inbox_discard()}
                  </Btn>
                </span>
              </div>

              {/* Live long-op progress for the plan currently streaming over
                  the OperationEvent channel (spec 042 US16 / FR-021). */}
              {progress && progressPlanId === plan.planId && (
                <div
                  className="pv-plan-panel__progress"
                  data-testid={`plan-progress-${plan.inboxItemId}`}
                  role="status"
                  aria-live="polite"
                >
                  {(() => {
                    // Count label ("N" or "N of M") — kept as a sub-message so the
                    // "of" connector stays translatable; passed into the plural
                    // variant messages below as {countText}.
                    const countText =
                      progress.total != null
                        ? m.inbox_progress_count_of({
                            applied: progress.applied,
                            total: progress.total,
                          })
                        : String(progress.applied);
                    if (progress.terminal === 'completed') {
                      return m.inbox_progress_completed({
                        applied: progress.applied,
                        countText,
                      });
                    }
                    if (progress.terminal === 'failed') {
                      return m.inbox_progress_failed({
                        applied: progress.applied,
                        failed: progress.failed,
                      });
                    }
                    const failedText =
                      progress.failed > 0
                        ? m.inbox_progress_failed_suffix({
                            failed: progress.failed,
                          })
                        : '';
                    return m.inbox_progress_running({
                      applied: progress.applied,
                      countText,
                      failedText,
                    });
                  })()}
                </div>
              )}

              {plan.stale && (
                <Banner
                  variant="danger"
                  className="pv-plan-panel__stale-banner"
                >
                  {m.inbox_stale_plan_warning()}
                </Banner>
              )}

              {/* Per-file detail — grid rows that share the PARENT column
                  template, so File aligns under "Plan", action under
                  "Composition", and the destination under "Destination". Hidden
                  until expanded. */}
              {isExpanded && (
                <div className="pv-plan-panel__file-rows" id={rowsId}>
                  {plan.actions.map((a, actionPos) => {
                    const rowIdx = planRowOffsets[planIdx] + actionPos;
                    // FR-031: prefer the absolute destination path from the last
                    // confirm response (keyed by source path); fall back to the
                    // root-relative preview for plans without a captured absolute.
                    const absolute = absoluteByFromPath?.[a.fromPath];
                    const destText = absolute ?? a.destinationPreview;
                    const inPlace =
                      a.action === 'catalogue' ||
                      a.destinationPreview === a.fromPath;
                    return (
                      <div key={a.index} className="pv-plan-panel__file-row">
                        <span aria-hidden="true" />
                        <span
                          className="pv-plan-panel__file-name"
                          title={a.fromPath}
                        >
                          {basename(a.fromPath)}
                        </span>
                        <span className="pv-plan-panel__file-action">
                          {/* Per-file frame type (composition), inferred from the
                              path / item hint — not the repetitive action kind. */}
                          {frameTypeLabel(
                            a,
                            destText,
                            frameTypeByItemId?.[plan.inboxItemId],
                          )}
                          {a.requiresDestructiveConfirm && (
                            <span className="pv-plan-panel__file-flag">
                              {m.inbox_destructive_flag()}
                            </span>
                          )}
                        </span>
                        <span className="pv-plan-panel__file-dest">
                          {inPlace ? (
                            <span className="pv-plan-panel__inplace">
                              {m.inbox_inplace_label()}
                            </span>
                          ) : (
                            <>
                              <span
                                className="pv-plan-panel__summary-arrow"
                                aria-hidden="true"
                              >
                                →{' '}
                              </span>
                              <code
                                className="pv-plan-panel__dest"
                                data-testid={`inbox-dest-absolute-${rowIdx}`}
                                title={destText}
                              >
                                {destText}
                              </code>
                            </>
                          )}
                        </span>
                        <span />
                        <span />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Destructive destination control (relocated from ActionSidebar) ── */}
      {hasDestructive && (
        <div className="pv-plan-panel__destructive">
          <div className="pv-plan-panel__destructive-title">
            {m.inbox_where_source_files_go()}
          </div>
          <div className="pv-plan-panel__dest-options">
            {}
            <label className="pv-plan-panel__dest-label">
              <input
                type="radio"
                name="destructive-destination"
                value="archive"
                checked={destructiveDestination === 'archive'}
                onChange={() => onDestructiveDestinationChange('archive')}
                aria-label={m.inbox_archive_folder()}
                data-testid="plan-destructive-archive"
              />
              <span>
                <strong>{m.inbox_archive_folder()}</strong>
                <span className="pv-plan-panel__dest-label-hint">
                  {m.inbox_archive_hint()}
                </span>
              </span>
            </label>
            {}
            <label className="pv-plan-panel__dest-label">
              <input
                type="radio"
                name="destructive-destination"
                value="trash"
                checked={destructiveDestination === 'trash'}
                onChange={() => onDestructiveDestinationChange('trash')}
                aria-label={m.inbox_system_trash()}
                data-testid="plan-destructive-trash"
              />
              <span>{m.inbox_system_trash()}</span>
            </label>
          </div>

          {/* Destructive-confirm gate (FR-003, D9, issue #741): destructive
              items (trash/delete) were previously refused permanently at
              apply time — `destructive_confirmed` had no writer. Plan-level
              (not per-item — `InboxPlanAction` carries no item id). */}
          <label className="pv-plan-panel__dest-label">
            <input
              type="checkbox"
              checked={allDestructiveConfirmed}
              disabled={confirmingDestructive || allDestructiveConfirmed}
              onChange={() => void handleConfirmDestructive()}
              aria-label={m.inbox_confirm_destructive_aria()}
              data-testid="plan-destructive-confirm"
            />
            <span>
              {confirmingDestructive
                ? m.inbox_confirm_destructive_confirming()
                : m.inbox_confirm_destructive_label()}
            </span>
          </label>
          {confirmDestructiveError !== null && (
            <Banner variant="danger">{confirmDestructiveError}</Banner>
          )}
        </div>
      )}
    </div>
  );
}
