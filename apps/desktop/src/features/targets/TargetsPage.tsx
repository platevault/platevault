/**
 * TargetsPage -- two-pane layout using PageShell + ListDetailLayout.
 * TopActionBar with spec-correct actions: Edit aliases, Link plan, New project.
 * Removes "+ New target" action per spec 030.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { listTargets } from '@/api/commands';
import { EmptyState } from '@/ui';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { TargetList } from './TargetList';
import { TargetDetailPane } from './TargetDetailPane';

const targetsStore = createQueryStore(() => listTargets());

export function TargetsPage() {
  const { data, loading } = useQuery(targetsStore);
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const targets = data ?? [];
  const effectiveId = selectedId ?? (targets.length > 0 ? targets[0].id : undefined);

  return (
    <PageShell
      testId="TargetsPage"
      loading={loading}
      loadingMessage="Loading targets..."
      empty={{
        title: 'No targets yet',
        description: 'Targets are created automatically when sessions are confirmed, or you can add them manually.',
      }}
      hasData={targets.length > 0}
    >
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Targets"
            subtitle={`${targets.length} targets`}
            actions={[
              { label: 'Edit aliases', disabled: !effectiveId, onClick: () => {} },
              { label: 'Link plan', disabled: !effectiveId, onClick: () => {} },
              {
                label: 'New project',
                variant: 'primary',
                disabled: !effectiveId,
                onClick: () => navigate({ to: '/projects/new', search: { target: effectiveId } }),
              },
            ]}
          />
        }
        list={
          <TargetList
            targets={targets}
            selectedId={effectiveId}
            onSelect={setSelectedId}
          />
        }
        detail={
          effectiveId ? (
            <TargetDetailPane targetId={effectiveId} />
          ) : (
            <EmptyState
              title="Select a target"
              description="Choose a target from the list to view its details."
            />
          )
        }
      />
    </PageShell>
  );
}
