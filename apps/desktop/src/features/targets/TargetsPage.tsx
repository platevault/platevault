import { useState } from 'react';
import { useQuery, createQueryStore } from '@/data/store';
import { listTargets } from '@/api/commands';
import { ThreePane, EmptyState } from '@/ui';
import { TargetList } from './TargetList';
import { TargetDetailPane } from './TargetDetailPane';

const targetsStore = createQueryStore(() => listTargets());

export function TargetsPage() {
  const { data, loading } = useQuery(targetsStore);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (loading) {
    return <div className="alm-page__loading">Loading targets...</div>;
  }

  const targets = data ?? [];

  if (targets.length === 0) {
    return (
      <div className="alm-page" data-testid="TargetsPage">
        <EmptyState
          title="No targets yet"
          description="Targets are created automatically when sessions are confirmed, or you can add them manually."
        />
      </div>
    );
  }

  // Auto-select first target if none selected yet
  const effectiveId = selectedId ?? (targets.length > 0 ? targets[0].id : undefined);

  return (
    <div className="alm-page" data-testid="TargetsPage">
      <ThreePane
        list={
          <TargetList
            targets={targets}
            selectedId={effectiveId}
            onSelect={setSelectedId}
          />
        }
        content={
          effectiveId ? (
            <TargetDetailPane targetId={effectiveId} />
          ) : (
            <div className="alm-page__empty">Select a target to view details</div>
          )
        }
        detail={<div />}
        listWidth={260}
        detailWidth={0}
      />
    </div>
  );
}
