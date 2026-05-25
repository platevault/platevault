import { useState, useCallback } from 'react';
import {
  useQuery,
  useParameterizedQuery,
  createQueryStore,
  createParameterizedStore,
  invalidateStores,
} from '@/data/store';
import { listPlans, getPlan, approvePlan, discardPlan } from '@/api/commands';
import type { PlanDetail } from '@/bindings/types';
import { ThreePane, EmptyState } from '@/ui';
import { PlansList } from './PlansList';
import { PlanReviewInline } from './PlanReviewInline';
import { PlanInspector } from './PlanInspector';

const plansStore = createQueryStore(() => listPlans());
const planDetailStore = createParameterizedStore<string, PlanDetail>((id) =>
  getPlan({ id }),
);

export function PlansPage() {
  const { data, loading } = useQuery(plansStore);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const { data: planDetail, loading: detailLoading } = useParameterizedQuery(
    planDetailStore,
    selectedId ?? '',
  );

  const handleApprove = useCallback(async () => {
    if (!planDetail) return;
    const acknowledged = planDetail.has_destructive ? true : undefined;
    await approvePlan({ id: planDetail.id, delete_acknowledged: acknowledged });
    planDetailStore.invalidate(selectedId!);
    invalidateStores(plansStore);
  }, [planDetail, selectedId]);

  const handleDiscard = useCallback(async () => {
    if (!planDetail) return;
    await discardPlan({ id: planDetail.id });
    planDetailStore.invalidate(selectedId!);
    invalidateStores(plansStore);
  }, [planDetail, selectedId]);

  if (loading) {
    return (
      <div className="alm-page" data-testid="PlansPage">
        <div className="alm-page__loading">Loading plans...</div>
      </div>
    );
  }

  const plans = data ?? [];

  return (
    <div className="alm-page" data-testid="PlansPage">
      <ThreePane
        list={
          <PlansList
            plans={plans}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
        content={
          selectedId && planDetail && !detailLoading ? (
            <PlanReviewInline plan={planDetail} onApprove={handleApprove} />
          ) : selectedId && detailLoading ? (
            <div className="alm-page__loading">Loading plan...</div>
          ) : (
            <EmptyState
              title="No plan selected"
              description="Select a plan from the list to review its items, diff, and approval state."
            />
          )
        }
        detail={
          selectedId && planDetail && !detailLoading ? (
            <PlanInspector
              plan={planDetail}
              onApprove={handleApprove}
              onDiscard={handleDiscard}
            />
          ) : (
            <div className="alm-inspector">
              <div className="alm-inspector__empty">
                Select a plan to view its summary
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
