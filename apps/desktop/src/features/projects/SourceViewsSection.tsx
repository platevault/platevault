/**
 * SourceViewsSection — spec 026 UI surface in ProjectDetail.
 *
 * Shows generated source views for a project with:
 * - State badge (current / stale / missing / removed / failed / kind_diverged)
 * - Remove action → routes to plan review (spec 017)
 * - Regenerate action → routes to plan review for removed/stale views
 * - Stale indicator badge
 * - kind_diverged affordance with manual-resolution message
 *
 * Per FR-003 / R-026-Pipeline: both actions produce a plan_id that is routed
 * through the spec 017/025 pipeline. The UI directs the user to the Plans page
 * with a toast on success.
 *
 * Spec 030 note: layout must follow Spec 030 design-v4 patterns when that
 * spec lands. For now this follows the existing ProjectDetail Section pattern.
 */

import { useState, useEffect } from 'react';
import { Pill, Btn, Section, Banner } from '@/ui';
import { m } from '@/lib/i18n';
import { addToast } from '@/shared/toast';
import {
  listPreparedViews,
  removePreparedView,
  regeneratePreparedView,
  viewStateLabel,
  viewStateVariant,
  canRemoveView,
  canRegenerateView,
} from './source-views';
import type { PreparedViewSummary, PreparedViewItemDetail } from './source-views';
import { errMessage } from '@/lib/errors';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SourceViewsSectionProps {
  projectId: string;
  /** Called with planId after a plan is created so the parent can navigate. */
  onPlanCreated?: (planId: string) => void;
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SourceViewsSection({ projectId, onPlanCreated, defaultOpen = true }: SourceViewsSectionProps) {
  const [views, setViews] = useState<PreparedViewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyViewId, setBusyViewId] = useState<string | null>(null);

  // Load views on mount or when projectId changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listPreparedViews(projectId)
      .then((resp) => {
        if (!cancelled) {
          setViews(resp.views);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleRemove(viewId: string) {
    setBusyViewId(viewId);
    try {
      const resp = await removePreparedView(viewId);
      const planId = resp.planId;
      addToast({
        variant: 'info',
        message: m.projects_source_views_removal_toast(),
        action: { label: m.projects_source_views_view_plan_btn(), onClick: () => onPlanCreated?.(planId) },
      });
      onPlanCreated?.(planId);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err).code)
          : 'internal';
      addToast({
        variant: 'warn',
        message: m.projects_source_views_removal_failed({ code }),
      });
    } finally {
      setBusyViewId(null);
    }
  }

  async function handleRegenerate(viewId: string) {
    setBusyViewId(viewId);
    try {
      const resp = await regeneratePreparedView(viewId);
      const planId = resp.planId;
      const warning =
        resp.unresolvedItemCount > 0
          ? m.projects_source_views_regen_unresolved({ count: String(resp.unresolvedItemCount) })
          : '';
      addToast({
        variant: 'info',
        message: m.projects_source_views_regen_toast({ warning }),
        action: { label: m.projects_source_views_view_plan_btn(), onClick: () => onPlanCreated?.(planId) },
      });
      onPlanCreated?.(planId);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err).code)
          : 'internal';
      addToast({
        variant: 'warn',
        message: m.projects_source_views_regen_failed({ code }),
      });
    } finally {
      setBusyViewId(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Section title={m.projects_source_views_title()} defaultOpen={defaultOpen}>
        <p className="text-muted text-sm">{m.common_loading()}</p>
      </Section>
    );
  }

  if (error) {
    return (
      <Section title={m.projects_source_views_title()} defaultOpen={defaultOpen}>
        <Banner variant="danger">{m.projects_source_views_load_error({ error })}</Banner>
      </Section>
    );
  }

  if (views.length === 0) {
    return (
      <Section title={m.projects_source_views_title()} defaultOpen={defaultOpen}>
        <p className="text-muted text-sm">{m.projects_source_views_empty()}</p>
      </Section>
    );
  }

  return (
    <Section title={m.projects_source_views_title()} defaultOpen={defaultOpen}>
      <ul className="flex flex-col gap-3">
        {views.map((view) => (
          <li
            key={view.id}
            className="flex items-center justify-between gap-4 rounded border border-border p-3"
            data-testid={`source-view-row-${view.id}`}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted truncate" title={view.id}>
                  {view.id.slice(0, 8)}…
                </span>
                <Pill variant={viewStateVariant(view.state)}>
                  {viewStateLabel(view.state)}
                </Pill>
                <span className="text-xs text-muted">{view.kind}</span>
                <span className="text-xs text-muted">{view.itemCount} {m.projects_source_views_items_unit()}</span>
              </div>

              {/* FR-033 / T078: per-item inventory refs */}
              {view.items.length > 0 && (
                <details className="text-xs text-muted alm-source-views__refs-details">
                  <summary className="alm-source-views__refs-summary">
                    {view.items.length} {m.projects_source_views_inventory_ref()}
                    {/* eslint-disable-next-line alm/no-user-string -- lone plural suffix */}
                    {view.items.length !== 1 ? 's' : ''}
                  </summary>
                  <ul
                    className="alm-source-views__refs-list"
                    data-testid={`source-view-items-${view.id}`}
                  >
                    {view.items.map((item: PreparedViewItemDetail) => (
                      <li
                        key={item.id}
                        title={m.projects_source_view_item_title({ id: item.inventoryItemId })}
                        className="alm-source-views__refs-item"
                      >
                        {item.viewRelativePath}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* kind_diverged resolution affordance (D-026-H2) */}
              {view.state === 'kind_diverged' && (
                <Banner variant="warn">
                  {m.projects_source_views_kind_mismatch()}
                </Banner>
              )}
            </div>

            <div className="flex gap-2 shrink-0">
              {canRemoveView(view.state) && (
                <Btn
                  size="sm"
                  variant="danger"
                  disabled={busyViewId !== null}
                  onClick={() => handleRemove(view.id)}
                  data-testid={`remove-view-${view.id}`}
                >
                  {busyViewId === view.id ? m.common_working() : m.common_remove()}
                </Btn>
              )}

              {canRegenerateView(view.state) && (
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={busyViewId !== null}
                  onClick={() => handleRegenerate(view.id)}
                  data-testid={`regenerate-view-${view.id}`}
                >
                  {busyViewId === view.id ? m.common_working() : m.common_regenerate()}
                </Btn>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
