/**
 * ViewAuditHistory — spec 026 T019 audit-history surface for a single
 * prepared source view.
 *
 * Lists the view's `prepared_view_removal`/`prepared_view_regeneration`
 * plans (spec 025 apply history is origin-agnostic and already durable —
 * `plan_apply_events`, T018/T020 — this surfaces the plan-level summary of
 * that trail rather than re-fetching every event row). Each plan can be
 * opened in the existing shared `PlanReviewOverlay` (spec 017) via
 * `onViewPlan`, which already renders full per-item detail/state — so this
 * component stays a thin, scoped list rather than a second item-detail view.
 *
 * `plans.list` filters server-side by `origin` only; the `originPath` (view
 * id) match is client-side since a per-view server filter doesn't exist and
 * the plan volume per view is small.
 */

import { useState } from 'react';
import { Btn, Pill } from '@/ui';
import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { errMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/datetime';
import type { PlanSummary, PlanState } from '@/bindings/index';

const HISTORY_ORIGINS = ['prepared_view_removal', 'prepared_view_regeneration'];
const HISTORY_LIMIT = 200;

function planStateVariant(
  state: PlanState,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (state) {
    case 'applied':
      return 'ok';
    case 'partially_applied':
    case 'paused':
      return 'warn';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

export interface ViewAuditHistoryProps {
  viewId: string;
  /** Opens the plan in the shared plan review overlay for full item detail. */
  onViewPlan?: (planId: string) => void;
}

export function ViewAuditHistory({
  viewId,
  onViewPlan,
}: ViewAuditHistoryProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const resp = unwrap(
        await commands.plansList(null, HISTORY_ORIGINS, null, HISTORY_LIMIT),
      );
      setPlans(resp.plans.filter((p) => p.originPath === viewId));
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="text-xs text-muted alm-source-views__refs-details"
      data-testid={`view-history-${viewId}`}
      onToggle={(e) => {
        if (
          (e.target as HTMLDetailsElement).open &&
          plans === null &&
          !loading
        ) {
          void load();
        }
      }}
    >
      <summary className="alm-source-views__refs-summary">
        {m.projects_source_views_history_toggle()}
      </summary>

      {loading && <p>{m.common_loading()}</p>}
      {error !== null && (
        <p>{m.projects_source_views_history_load_error({ error })}</p>
      )}

      {!loading && error === null && plans !== null && plans.length === 0 && (
        <p>{m.projects_source_views_history_empty()}</p>
      )}

      {!loading && error === null && plans !== null && plans.length > 0 && (
        <ul className="alm-source-views__refs-list">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className="alm-source-views__refs-item flex items-center gap-2"
              data-testid={`view-history-row-${plan.id}`}
            >
              <span className="font-mono">
                {formatDateTime(plan.createdAt)}
              </span>
              <span>
                {plan.origin === 'prepared_view_removal'
                  ? m.projects_source_views_history_row_removal()
                  : m.projects_source_views_history_row_regeneration()}
              </span>
              <Pill variant={planStateVariant(plan.state)}>{plan.state}</Pill>
              <span>
                {m.projects_source_views_history_counts({
                  applied: String(plan.itemsApplied),
                  failed: String(plan.itemsFailed),
                })}
              </span>
              {onViewPlan && (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => onViewPlan(plan.id)}
                  data-testid={`view-history-open-${plan.id}`}
                >
                  {m.projects_source_views_history_view_btn()}
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
