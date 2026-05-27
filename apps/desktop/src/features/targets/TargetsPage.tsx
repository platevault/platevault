/**
 * TargetsPage -- list-detail layout with ListSidebar-based TargetList
 * and TopActionBar. 4 grouping options: type/constellation/catalog/project.
 * Refactored per spec 030 T077.
 */

import { useState } from 'react';
import { useQuery, createQueryStore } from '@/data/store';
import { listTargets } from '@/api/commands';
import { EmptyState } from '@/ui';
import { TopActionBar } from '@/components';
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

  const effectiveId = selectedId ?? (targets.length > 0 ? targets[0].id : undefined);

  return (
    <div className="alm-page" data-testid="TargetsPage">
      <TopActionBar
        title="Targets"
        subtitle={`${targets.length} targets`}
        actions={[
          { label: '+ New target', variant: 'primary', onClick: () => {} },
        ]}
      />
      <div className="alm-list-detail-layout">
        <div className="alm-list-detail-layout__list">
          <TargetList
            targets={targets}
            selectedId={effectiveId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="alm-list-detail-layout__detail">
          {effectiveId ? (
            <TargetDetailPane targetId={effectiveId} />
          ) : (
            <div className="alm-page__empty">Select a target to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}
