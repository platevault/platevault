/**
 * PlanPanel — in-context plan panel for the Inbox review surface.
 *
 * Renders at the bottom of the inbox central area to show the pending
 * filesystem plan for the selected item (spec 041, US1 T013 + US7 T041).
 *
 * Pure presentational component — no data fetching. Interfaces are defined
 * locally until generated binding types are available (the parent will swap
 * them to generated types later).
 */

import { useMemo } from 'react';
import { Banner, Btn } from '@/ui';

// ── Local DTOs (swap to generated bindings when available) ───────────────────

export type PlanActionKind = 'move' | 'catalogue' | 'archive' | 'trash';

export interface PlanActionView {
  index: number;
  action: PlanActionKind;
  fromPath: string;
  toPath: string;
  destinationPreview: string | null;
  requiresDestructiveConfirm: boolean;
}

export interface PlanView {
  planId: string;
  state: string;
  stale?: boolean;
  actions: PlanActionView[];
}

export type DestructiveDestination = 'archive' | 'os_trash';

export interface PlanPanelProps {
  plan: PlanView | null;
  destructiveDestination: DestructiveDestination;
  onDestructiveDestinationChange: (d: DestructiveDestination) => void;
  onApply: () => void;
  onApplyAll?: () => void;
  onCancel: () => void;
  busy?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<PlanActionKind, string> = {
  move: 'Move',
  catalogue: 'Catalogue',
  archive: 'Archive',
  trash: 'Trash',
};

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Build a human summary like "3 move · 2 catalogue". */
function buildCountSummary(actions: PlanActionView[]): string {
  const counts = new Map<PlanActionKind, number>();
  for (const a of actions) {
    counts.set(a.action, (counts.get(a.action) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${count} ${ACTION_LABELS[kind].toLowerCase()}`)
    .join(' · ');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlanPanel({
  plan,
  destructiveDestination,
  onDestructiveDestinationChange,
  onApply,
  onApplyAll,
  onCancel,
  busy = false,
}: PlanPanelProps) {
  const hasDestructive = useMemo(
    () => plan?.actions.some((a) => a.requiresDestructiveConfirm) ?? false,
    [plan],
  );

  // Group actions by kind for section headers.
  const byKind = useMemo<Map<PlanActionKind, PlanActionView[]>>(() => {
    const m = new Map<PlanActionKind, PlanActionView[]>();
    for (const a of plan?.actions ?? []) {
      const list = m.get(a.action);
      if (list) {
        list.push(a);
      } else {
        m.set(a.action, [a]);
      }
    }
    return m;
  }, [plan]);

  const countSummary = plan ? buildCountSummary(plan.actions) : '';

  // Apply is disabled when busy, no plan, or plan is stale.
  const applyDisabled = busy || !plan || !!plan.stale;

  return (
    <div className="alm-plan-panel" data-testid="plan-panel">

      {/* ── Header ── */}
      <div
        className="alm-plan-panel__header"
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--alm-sp-2)' }}
      >
        <span
          className="alm-plan-panel__title"
          style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}
        >
          Planned actions
        </span>
        {countSummary && (
          <span
            className="alm-plan-panel__count-summary"
            style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}
          >
            {countSummary}
          </span>
        )}
      </div>

      {/* ── Stale warning ── */}
      {plan?.stale && (
        <Banner variant="danger" style={{ marginTop: 'var(--alm-sp-2)' }}>
          Source files changed — regenerate the plan before applying.
        </Banner>
      )}

      {/* ── Action list grouped by kind ── */}
      {plan && plan.actions.length > 0 && (
        <div className="alm-plan-panel__actions" style={{ marginTop: 'var(--alm-sp-3)' }}>
          {([...byKind.entries()] as Array<[PlanActionKind, PlanActionView[]]>).map(
            ([kind, acts]) => (
              <div
                key={kind}
                className="alm-plan-panel__group"
                style={{ marginBottom: 'var(--alm-sp-3)' }}
              >
                {/* Kind header */}
                <div
                  className="alm-plan-panel__group-header"
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    fontWeight: 600,
                    color: 'var(--alm-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 'var(--alm-sp-1)',
                  }}
                >
                  {ACTION_LABELS[kind]} ({acts.length})
                </div>

                {/* Action rows */}
                <div className="alm-plan-panel__rows">
                  {acts.map((a) => (
                    <div
                      key={a.index}
                      className="alm-plan-panel__row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 'var(--alm-sp-2)',
                        padding: 'var(--alm-sp-1) 0',
                        borderBottom: '1px solid var(--alm-border)',
                        fontSize: 'var(--alm-text-xs)',
                      }}
                    >
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
                      {a.destinationPreview != null ? (
                        <code
                          className="alm-plan-panel__dest"
                          style={{
                            color: 'var(--alm-text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={a.destinationPreview}
                        >
                          {a.destinationPreview}
                        </code>
                      ) : (
                        <span
                          style={{ color: 'var(--alm-text-muted)', fontStyle: 'italic' }}
                        >
                          computed on confirm
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {plan && plan.actions.length === 0 && (
        <div
          style={{
            color: 'var(--alm-text-muted)',
            fontSize: 'var(--alm-text-sm)',
            marginTop: 'var(--alm-sp-3)',
          }}
        >
          No planned actions.
        </div>
      )}

      {!plan && (
        <div
          style={{
            color: 'var(--alm-text-muted)',
            fontSize: 'var(--alm-text-sm)',
            marginTop: 'var(--alm-sp-3)',
          }}
        >
          No plan generated yet.
        </div>
      )}

      {/* ── Destructive destination control ── */}
      {hasDestructive && (
        <div
          className="alm-plan-panel__destructive"
          style={{
            marginTop: 'var(--alm-sp-4)',
            padding: 'var(--alm-sp-3)',
            background: 'var(--alm-surface-raised)',
            borderRadius: 'var(--alm-radius)',
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
            Destructive action destination
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
                value="os_trash"
                checked={destructiveDestination === 'os_trash'}
                onChange={() => onDestructiveDestinationChange('os_trash')}
                data-testid="plan-destructive-trash"
              />
              <span>System Trash</span>
            </label>
          </div>
        </div>
      )}

      {/* ── Footer buttons ── */}
      <div
        className="alm-plan-panel__footer"
        style={{
          display: 'flex',
          gap: 'var(--alm-sp-2)',
          marginTop: 'var(--alm-sp-4)',
          alignItems: 'center',
        }}
      >
        <Btn
          variant="primary"
          onClick={onApply}
          disabled={applyDisabled}
          data-testid="plan-apply"
          aria-label="Apply plan"
        >
          {busy ? 'Applying…' : 'Apply'}
        </Btn>
        {onApplyAll && (
          <Btn
            variant="accent"
            onClick={onApplyAll}
            disabled={applyDisabled}
            data-testid="plan-apply-all"
            aria-label="Apply all plans"
          >
            Apply all
          </Btn>
        )}
        <Btn
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          data-testid="plan-cancel"
          aria-label="Cancel plan"
        >
          Cancel
        </Btn>
      </div>
    </div>
  );
}
