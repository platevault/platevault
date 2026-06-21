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

import { useEffect, useMemo, useState } from 'react';
import { Banner, Btn } from '@/ui';
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

/** Build a human summary like "3 move · 2 catalogue" for one group. */
function buildCountSummary(actions: InboxPlanAction[]): string {
  const counts = new Map<string, number>();
  for (const a of actions) {
    counts.set(a.action, (counts.get(a.action) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${count} ${actionLabel(kind).toLowerCase()}`)
    .join(' · ');
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
}: PlanPanelProps) {
  // Plan-level selection set, keyed by inboxItemId. Stale plans cannot be
  // selected (and are pruned from the set if they become stale).
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      style={{
        marginBottom: 'var(--alm-sp-3)',
        padding: 'var(--alm-sp-3)',
        border: '1px solid var(--alm-warn, var(--alm-border))',
        borderRadius: 'var(--alm-radius-md)',
        background: 'var(--alm-surface-raised, var(--alm-bg3))',
      }}
    >
      <div
        style={{
          fontSize: 'var(--alm-text-sm)',
          fontWeight: 600,
          marginBottom: 'var(--alm-sp-1)',
        }}
      >
        Choose a destination library root
      </div>
      <div
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          marginBottom: 'var(--alm-sp-2)',
        }}
      >
        More than one library root can host <strong>{pendingRootPick.category}</strong> frames.
        Pick where these files should go to generate the plan.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
        {pendingRootPick.candidates.map((c) => (
          <Btn
            key={c.rootId}
            variant="ghost"
            onClick={() => onPickDestinationRoot?.(c.rootId)}
            disabled={rootPickBusy}
            data-testid={`inbox-root-option-${c.rootId}`}
            aria-label={`Use ${c.path} as destination root`}
            style={{ justifyContent: 'flex-start', textAlign: 'left' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <code style={{ fontSize: 'var(--alm-text-xs)' }}>{c.path}</code>
              <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
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
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={allSelectableSelected}
              onChange={toggleAll}
              disabled={selectableIds.length === 0}
              aria-label="Select all plans"
              data-testid="plan-select-all"
            />
            <span
              className="alm-plan-panel__title"
              style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}
            >
              Planned actions
            </span>
          </label>
          <span
            className="alm-plan-panel__count-summary"
            style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}
            data-testid="plan-total-count"
          >
            {plans.length} plan{plans.length !== 1 ? 's' : ''} · {totalActions} action
            {totalActions !== 1 ? 's' : ''}
          </span>
        </div>
        <div
          className="alm-plan-panel__bar-actions"
          style={{ display: 'flex', gap: 'var(--alm-sp-2)', alignItems: 'center' }}
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

      <div
        className="alm-plan-panel__hint"
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          marginTop: 'var(--alm-sp-1)',
        }}
      >
        Selection is per ingestion — checking a group applies that whole plan.
      </div>

      {/* ── Scrollable group list ── */}
      <div className="alm-plan-panel__scroll" data-testid="plan-panel-scroll">
        {plans.map((plan, planIdx) => {
          const checked = selected.has(plan.inboxItemId);
          return (
            <section
              key={plan.inboxItemId}
              className="alm-plan-panel__group"
              data-testid={`plan-group-${plan.inboxItemId}`}
              style={{ marginBottom: 'var(--alm-sp-3)' }}
            >
              {/* Group header */}
              <div
                className="alm-plan-panel__group-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-sp-2)',
                  paddingBottom: 'var(--alm-sp-1)',
                  borderBottom: '1px solid var(--alm-border)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={plan.stale}
                  onChange={() => toggleGroup(plan.inboxItemId, plan.stale)}
                  aria-label={`Select plan for ${plan.itemName}`}
                  data-testid={`plan-group-check-${plan.inboxItemId}`}
                />
                <span
                  className="alm-plan-panel__group-name"
                  style={{
                    fontWeight: 600,
                    fontSize: 'var(--alm-text-sm)',
                    color: 'var(--alm-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={plan.itemName}
                >
                  {plan.itemName}
                </span>
                <span
                  style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}
                >
                  {buildCountSummary(plan.actions)}
                </span>
                {plan.stale && (
                  <span
                    className="alm-plan-panel__stale-badge"
                    data-testid={`plan-stale-${plan.inboxItemId}`}
                    style={{
                      fontSize: 'var(--alm-text-xs)',
                      fontWeight: 600,
                      color: 'var(--alm-danger, var(--alm-warn))',
                      border: '1px solid currentColor',
                      borderRadius: 'var(--alm-radius-md)',
                      padding: '0 var(--alm-sp-1)',
                    }}
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
                <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-1)' }}>
                  Source files changed — discard and re-confirm to regenerate this plan.
                </Banner>
              )}

              {/* Action rows */}
              <div className="alm-plan-panel__rows">
                {plan.actions.map((a, actionPos) => {
                  const rowIdx = planRowOffsets[planIdx] + actionPos;
                  // FR-031: prefer the absolute destination path from the last
                  // confirm response (keyed by source path); fall back to the
                  // root-relative preview for plans without a captured absolute.
                  const absolute = absoluteByFromPath?.[a.fromPath];
                  const destText = absolute ?? a.destinationPreview;
                  return (
                  <div
                    key={a.index}
                    className="alm-plan-panel__row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr 1fr',
                      gap: 'var(--alm-sp-2)',
                      padding: 'var(--alm-sp-1) 0',
                      borderBottom: '1px solid var(--alm-border)',
                      fontSize: 'var(--alm-text-xs)',
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      className="alm-plan-panel__kind"
                      style={{
                        color: 'var(--alm-text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        fontWeight: 600,
                      }}
                    >
                      {actionLabel(a.action)}
                    </span>
                    <span
                      className="alm-plan-panel__filename"
                      style={{
                        color: 'var(--alm-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={a.fromPath}
                    >
                      {basename(a.fromPath)}
                    </span>
                    <code
                      className="alm-plan-panel__dest"
                      data-testid={`inbox-dest-absolute-${rowIdx}`}
                      style={{
                        color: 'var(--alm-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        direction: 'rtl',
                      }}
                      title={destText}
                    >
                      {destText}
                    </code>
                  </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Destructive destination control (relocated from ActionSidebar) ── */}
      {hasDestructive && (
        <div
          className="alm-plan-panel__destructive"
          style={{
            marginTop: 'var(--alm-sp-3)',
            padding: 'var(--alm-sp-3)',
            background: 'var(--alm-surface-raised, var(--alm-bg3))',
            borderRadius: 'var(--alm-radius-md)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--alm-text-xs)',
              fontWeight: 600,
              marginBottom: 'var(--alm-sp-2)',
              color: 'var(--alm-text-secondary)',
            }}
          >
            Where should removed source files go?
          </div>
          <div
            className="alm-plan-panel__dest-options"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', cursor: 'pointer' }}>
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
                <span
                  style={{
                    display: 'block',
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text-muted)',
                  }}
                >
                  Archive folder keeps a recoverable copy; System Trash uses the OS trash
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)', cursor: 'pointer' }}>
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
