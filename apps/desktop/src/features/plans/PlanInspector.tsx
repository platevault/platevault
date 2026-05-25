import type { PlanDetail, PlanState } from '@/bindings/types';
import { Pill, Btn, KV } from '@/ui';

export interface PlanInspectorProps {
  plan: PlanDetail;
  onApprove: () => void;
  onDiscard: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function planStateVariant(state: PlanState) {
  switch (state) {
    case 'applied':
      return 'ok' as const;
    case 'ready_for_review':
      return 'warn' as const;
    case 'approved':
    case 'applying':
      return 'neutral' as const;
    case 'failed':
    case 'cancelled':
    case 'discarded':
      return 'danger' as const;
    case 'partially_applied':
    case 'paused':
      return 'warn' as const;
    default:
      return 'ghost' as const;
  }
}

export function PlanInspector({ plan, onApprove, onDiscard }: PlanInspectorProps) {
  const { summary } = plan;
  const canApprove = plan.state === 'ready_for_review';
  const dryRunOk = plan.items.every((item) => item.dry_run_ok);

  return (
    <div className="alm-inspector">
      {/* Summary section */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">Summary</div>
        <div className="alm-inspector__stats">
          <div className="alm-inspector__stat">
            <span className="alm-inspector__stat-num alm-mono">
              {summary.item_count}
            </span>
            <span className="alm-inspector__stat-label">Items</span>
          </div>
          <div className="alm-inspector__stat">
            <span className="alm-inspector__stat-num alm-mono">
              {formatBytes(summary.reclaim_bytes)}
            </span>
            <span className="alm-inspector__stat-label">Reclaim</span>
          </div>
        </div>
        <div className="alm-inspector__kv-list">
          <KV label="Trash" value={String(summary.trash_count)} />
          <KV label="Archive" value={String(summary.archive_count)} />
          {summary.delete_count > 0 && (
            <KV
              label="Permanent delete"
              value={
                <span style={{ color: 'var(--alm-danger)', fontWeight: 600 }}>
                  {summary.delete_count}
                </span>
              }
            />
          )}
          <KV label="Protected (skipped)" value={String(summary.protected_count)} />
        </div>
      </div>

      {/* State section */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">State</div>
        <div className="alm-inspector__kv-list">
          <KV
            label="Status"
            value={
              <Pill
                label={plan.state.replace(/_/g, ' ')}
                variant={planStateVariant(plan.state)}
                size="sm"
              />
            }
          />
          <KV
            label="Kind"
            value={plan.kind.replace(/_/g, ' ')}
          />
          <KV label="Plan ID" value={<span className="alm-mono">{plan.id}</span>} />
        </div>
      </div>

      {/* Dry-run section */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">Dry-run</div>
        <div className="alm-inspector__kv-list">
          <KV
            label="Status"
            value={
              dryRunOk ? (
                <span style={{ color: 'var(--alm-ok)' }}>
                  All preconditions satisfied
                </span>
              ) : (
                <span style={{ color: 'var(--alm-danger)' }}>
                  Preconditions failed
                </span>
              )
            }
          />
          <KV
            label="Passed"
            value={<span className="alm-mono">{plan.dry_run_result.passed}</span>}
          />
          {plan.dry_run_result.warnings > 0 && (
            <KV
              label="Warnings"
              value={
                <span className="alm-mono" style={{ color: 'var(--alm-warn)' }}>
                  {plan.dry_run_result.warnings}
                </span>
              }
            />
          )}
          {plan.dry_run_result.failures > 0 && (
            <KV
              label="Failures"
              value={
                <span className="alm-mono" style={{ color: 'var(--alm-danger)' }}>
                  {plan.dry_run_result.failures}
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* Target project */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">Target</div>
        <div className="alm-inspector__kv-list">
          <KV label="Project" value="NGC 7000 -- HOO" />
        </div>
      </div>

      {/* Actions */}
      <div className="alm-inspector__section alm-inspector__actions">
        <div className="alm-inspector__section-label">Actions</div>
        <div className="alm-inspector__action-buttons">
          <Btn
            variant="primary"
            size="sm"
            disabled={!canApprove || !dryRunOk}
            onClick={onApprove}
          >
            Approve &amp; apply
          </Btn>
          <Btn size="sm" onClick={onDiscard}>
            Discard
          </Btn>
          <Btn size="sm">Edit policy</Btn>
        </div>
      </div>
    </div>
  );
}
