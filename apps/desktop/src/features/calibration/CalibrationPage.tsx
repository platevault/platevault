/**
 * CalibrationPage -- list-detail layout using TopActionBar.
 * Left: MastersList, Center: MasterDetail (full width, no right sidebar).
 * Refactored per spec 030 T075.
 */

import { useState } from 'react';
import { masters, calibrationSummary } from '@/data/fixtures/calibration';
import { TopActionBar } from '@/components';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

export function CalibrationPage() {
  const [selectedId, setSelectedId] = useState<string>('m-1');
  const [groupValue, setGroupValue] = useState('kind');

  return (
    <div className="alm-page" data-testid="CalibrationPage">
      <TopActionBar
        title="Calibration"
        subtitle={`${calibrationSummary.totalMasters} masters · ${calibrationSummary.darks} darks · ${calibrationSummary.flats} flats · ${calibrationSummary.bias} bias · ${calibrationSummary.agingCount} aging`}
        actions={[
          { label: 'Import master...', onClick: () => {} },
          { label: 'Re-run matching', onClick: () => {} },
        ]}
      />
      <div className="alm-list-detail-layout">
        <div className="alm-list-detail-layout__list">
          <MastersList
            masters={masters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            groupValue={groupValue}
            onGroupChange={setGroupValue}
          />
        </div>
        <div className="alm-list-detail-layout__detail">
          {selectedId ? (
            <MasterDetail masterId={selectedId} />
          ) : (
            <div className="alm-page__empty">
              Select a calibration master from the list to view its details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
