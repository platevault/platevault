/**
 * CalibrationPage -- two-pane layout using PageShell + ListDetailLayout.
 * TopActionBar with spec-correct actions (Use in Project, Reveal in Explorer, Archive).
 * Removes "Import master" and "Re-run matching" per spec 030.
 */

import { useState } from 'react';
import { masters, calibrationSummary } from '@/data/fixtures/calibration';
import { EmptyState } from '@/ui';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

export function CalibrationPage() {
  const [selectedId, setSelectedId] = useState<string>('m-1');
  const [groupValue, setGroupValue] = useState('kind');

  const selected = masters.find((m) => m.id === selectedId);

  return (
    <PageShell
      testId="CalibrationPage"
      empty={{
        title: 'No calibration masters',
        description: 'Calibration masters will appear after scanning your library.',
      }}
      hasData={masters.length > 0}
    >
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Calibration"
            subtitle={`${calibrationSummary.totalMasters} masters · ${calibrationSummary.darks} darks · ${calibrationSummary.flats} flats · ${calibrationSummary.bias} bias · ${calibrationSummary.agingCount} aging`}
            actions={[
              { label: 'Use in Project', disabled: !selected, onClick: () => {} },
              { label: 'Reveal in Explorer', disabled: !selected, onClick: () => {} },
              { label: 'Archive', variant: 'ghost', disabled: !selected, onClick: () => {} },
            ]}
          />
        }
        list={
          <MastersList
            masters={masters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            groupValue={groupValue}
            onGroupChange={setGroupValue}
          />
        }
        detail={
          selectedId ? (
            <MasterDetail masterId={selectedId} />
          ) : (
            <EmptyState
              title="Select a master"
              description="Choose a calibration master from the list to view its details."
            />
          )
        }
      />
    </PageShell>
  );
}
